package main

import (
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/zishang520/engine.io/v2/types"
	sio "github.com/zishang520/socket.io/v2/socket"
	"go.uber.org/zap"
	_ "modernc.org/sqlite"
)

//go:embed templates/viewer.html
var viewerHTML embed.FS

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

var (
	db     *sql.DB
	logger *zap.Logger
)

var (
	stateMu sync.RWMutex
	// activeConnections maps socket ID → client/game info
	activeConnections = make(map[sio.SocketId]connectionInfo)
	// gameRooms[gameID][questionIndex][choiceIndex] = count
	gameRooms = make(map[string]map[int]map[int]int)
)

type connectionInfo struct {
	ClientID string
	GameID   string
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

var allowedOriginSuffixes = []string{
	"wayground.com",
	"quizizz.com",
	"kahoot.it",
}

func isAllowedOrigin(origin string) bool {
	if origin == "" {
		return false
	}
	host := strings.TrimPrefix(strings.TrimPrefix(origin, "https://"), "http://")
	// Strip port (e.g. "example.com:3000" → "example.com")
	if idx := strings.LastIndex(host, ":"); idx > 0 && !strings.Contains(host[idx:], ".") {
		host = host[:idx]
	}
	for _, suffix := range allowedOriginSuffixes {
		if host == suffix || strings.HasSuffix(host, "."+suffix) {
			return true
		}
	}
	return false
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Let socket.io handle its own CORS; only add headers for other paths.
		if !strings.HasPrefix(r.URL.Path, "/api/socket.io") {
			origin := r.Header.Get("Origin")
			if isAllowedOrigin(origin) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, data interface{}, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

// ---------------------------------------------------------------------------
// Backwards-compatible answer serialisation
//
// The Python server stored correct_answers as str(python_value), e.g.:
//
//	int     0      → "0"
//	list    [0,2]  → "[0, 2]"
//	string  "Paris"→ "Paris"   (no surrounding quotes!)
//	None           → "None"
//	True/False     → "True" / "False"
//
// New records are written as JSON (compatible for numbers/arrays; strings are
// now written with surrounding JSON quotes, which parseStoredAnswer handles).
// ---------------------------------------------------------------------------

func parseStoredAnswer(s string) interface{} {
	switch s {
	case "None":
		return nil
	case "True":
		return true
	case "False":
		return false
	}
	var v interface{}
	if err := json.Unmarshal([]byte(s), &v); err == nil {
		return v
	}
	// Legacy Python repr: string stored without JSON quotes (e.g. "Paris")
	return s
}

func marshalAnswer(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(b)
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

func initDB() error {
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "./data"
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}
	var err error
	db, err = sql.Open("sqlite", dataDir+"/quiz_data.db")
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS questions (
		question_id     TEXT PRIMARY KEY,
		question_type   TEXT,
		correct_answers TEXT,
		created_at      TIMESTAMP,
		updated_at      TIMESTAMP
	)`)
	return err
}

type dbQuestion struct {
	QuestionID     string
	QuestionType   sql.NullString
	CorrectAnswers sql.NullString
	CreatedAt      string
	UpdatedAt      string
}

func getQuestion(id string) (*dbQuestion, error) {
	var q dbQuestion
	err := db.QueryRow(
		`SELECT question_id, question_type, correct_answers, created_at, updated_at
		 FROM questions WHERE question_id = ?`, id,
	).Scan(&q.QuestionID, &q.QuestionType, &q.CorrectAnswers, &q.CreatedAt, &q.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &q, nil
}

// saveQuestion mirrors the Python save_question logic:
//   - If the record doesn't exist, INSERT (NULLs for unset fields).
//   - If it exists, UPDATE only the non-nil fields.
func saveQuestion(questionID string, questionType *string, correctAnswers interface{}) error {
	existing, err := getQuestion(questionID)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format("2006-01-02T15:04:05.999999")

	if existing == nil {
		var qt sql.NullString
		if questionType != nil {
			qt = sql.NullString{String: *questionType, Valid: true}
		}
		var ans sql.NullString
		if correctAnswers != nil {
			ans = sql.NullString{String: marshalAnswer(correctAnswers), Valid: true}
		}
		_, err = db.Exec(
			`INSERT INTO questions (question_id, question_type, correct_answers, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?)`,
			questionID, qt, ans, now, now,
		)
		return err
	}

	if questionType != nil {
		if _, err = db.Exec(
			`UPDATE questions SET question_type = ?, updated_at = ? WHERE question_id = ?`,
			*questionType, now, questionID,
		); err != nil {
			return err
		}
	}
	if correctAnswers != nil {
		if _, err = db.Exec(
			`UPDATE questions SET correct_answers = ?, updated_at = ? WHERE question_id = ?`,
			marshalAnswer(correctAnswers), now, questionID,
		); err != nil {
			return err
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

// POST /api/question
func handleQueryQuestion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		QuestionID   string      `json:"questionId"`
		QuestionType string      `json:"questionType"`
		AnswerIDs    interface{} `json:"answerIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, map[string]string{"error": "invalid JSON"}, http.StatusBadRequest)
		return
	}
	if req.QuestionID == "" {
		writeJSON(w, map[string]string{"error": "Missing questionId"}, http.StatusBadRequest)
		return
	}

	q, err := getQuestion(req.QuestionID)
	if err != nil {
		writeJSON(w, map[string]string{"error": "database error"}, http.StatusInternalServerError)
		return
	}

	hasAnswer := q != nil && q.CorrectAnswers.Valid
	logger.Info("question",
		zap.String("id", req.QuestionID),
		zap.Bool("hasAnswer", hasAnswer),
	)

	// New question: create with NULL answer and return hasAnswer=false
	if q == nil {
		qt := req.QuestionType
		if saveErr := saveQuestion(req.QuestionID, &qt, nil); saveErr != nil {
			writeJSON(w, map[string]string{"error": "database error"}, http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]interface{}{
			"hasAnswer":      false,
			"correctAnswers": nil,
			"questionType":   req.QuestionType,
		}, http.StatusOK)
		return
	}

	// Existing question without answer yet
	if !q.CorrectAnswers.Valid {
		writeJSON(w, map[string]interface{}{
			"hasAnswer":      false,
			"correctAnswers": nil,
			"questionType":   q.QuestionType.String,
		}, http.StatusOK)
		return
	}

	// Known answer
	writeJSON(w, map[string]interface{}{
		"hasAnswer":      true,
		"correctAnswers": parseStoredAnswer(q.CorrectAnswers.String),
		"questionType":   q.QuestionType.String,
	}, http.StatusOK)
}

// POST /api/answer
func handleSaveAnswer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		QuestionID     string      `json:"questionId"`
		CorrectAnswers interface{} `json:"correctAnswers"`
		AnswerType     string      `json:"answerType"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, map[string]string{"error": "invalid JSON"}, http.StatusBadRequest)
		return
	}
	if req.QuestionID == "" || req.CorrectAnswers == nil || req.AnswerType == "" {
		writeJSON(w, map[string]string{"error": "Missing required fields"}, http.StatusBadRequest)
		return
	}

	existing, err := getQuestion(req.QuestionID)
	if err != nil {
		writeJSON(w, map[string]string{"error": "database error"}, http.StatusInternalServerError)
		return
	}
	if existing != nil && existing.CorrectAnswers.Valid {
		writeJSON(w, map[string]string{"error": "Answer already exists for this question"}, http.StatusForbidden)
		return
	}

	at := req.AnswerType
	if err := saveQuestion(req.QuestionID, &at, req.CorrectAnswers); err != nil {
		writeJSON(w, map[string]string{"error": "database error"}, http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]bool{"success": true}, http.StatusOK)
}

// GET /int/stats
func handleStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var total, answered int
	_ = db.QueryRow("SELECT COUNT(*) FROM questions").Scan(&total)
	_ = db.QueryRow("SELECT COUNT(*) FROM questions WHERE correct_answers IS NOT NULL").Scan(&answered)
	writeJSON(w, map[string]int{
		"totalQuestions":      total,
		"answeredQuestions":   answered,
		"unansweredQuestions": total - answered,
	}, http.StatusOK)
}

// GET /int/questions
func handleQuestions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rows, err := db.Query(
		`SELECT question_id, question_type, correct_answers, created_at, updated_at
		 FROM questions ORDER BY updated_at DESC`,
	)
	if err != nil {
		writeJSON(w, map[string]string{"error": "database error"}, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type qResp struct {
		QuestionID     string      `json:"questionId"`
		QuestionType   *string     `json:"questionType"`
		CorrectAnswers interface{} `json:"correctAnswers"`
		CreatedAt      string      `json:"createdAt"`
		UpdatedAt      string      `json:"updatedAt"`
	}
	result := make([]qResp, 0)
	for rows.Next() {
		var q dbQuestion
		if scanErr := rows.Scan(&q.QuestionID, &q.QuestionType, &q.CorrectAnswers, &q.CreatedAt, &q.UpdatedAt); scanErr != nil {
			continue
		}
		item := qResp{
			QuestionID: q.QuestionID,
			CreatedAt:  q.CreatedAt,
			UpdatedAt:  q.UpdatedAt,
		}
		if q.QuestionType.Valid {
			item.QuestionType = &q.QuestionType.String
		}
		if q.CorrectAnswers.Valid {
			item.CorrectAnswers = parseStoredAnswer(q.CorrectAnswers.String)
		}
		result = append(result, item)
	}
	writeJSON(w, result, http.StatusOK)
}

// POST /int/shutdown
func handleShutdown(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, map[string]string{"message": "Server shutting down..."}, http.StatusOK)
	go func() {
		time.Sleep(time.Second)
		os.Exit(0)
	}()
}

// POST /int/cleanup
func handleCleanup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var countBefore int
	_ = db.QueryRow("SELECT COUNT(*) FROM questions").Scan(&countBefore)
	res, err := db.Exec("DELETE FROM questions WHERE correct_answers IS NULL")
	if err != nil {
		writeJSON(w, map[string]string{"error": "database error"}, http.StatusInternalServerError)
		return
	}
	deleted, _ := res.RowsAffected()
	writeJSON(w, map[string]interface{}{
		"success":      true,
		"deletedCount": deleted,
		"countBefore":  countBefore,
	}, http.StatusOK)
}

// ---------------------------------------------------------------------------
// Socket.IO helpers
// ---------------------------------------------------------------------------

// toFloat64 converts common numeric socket.io event values to float64.
func toFloat64(v interface{}) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case json.Number:
		f, _ := n.Float64()
		return f
	}
	return 0
}

// anyToString converts an interface{} to string (handles numbers too, since
// gameId may arrive as a number from some clients).
func anyToString(v interface{}) string {
	switch s := v.(type) {
	case string:
		return s
	case float64:
		return fmt.Sprintf("%g", s)
	case int:
		return fmt.Sprintf("%d", s)
	default:
		b, _ := json.Marshal(v)
		return string(b)
	}
}

// ---------------------------------------------------------------------------
// Socket.IO server setup
// ---------------------------------------------------------------------------

func setupSocketIO() *sio.Server {
	opts := sio.DefaultServerOptions()
	opts.SetCors(&types.Cors{
		Origin:      "*",
		Credentials: true,
	})
	io := sio.NewServer(nil, opts)

	io.On("connection", func(clients ...interface{}) {
		client := clients[0].(*sio.Socket)
		logger.Info("ws connect", zap.String("id", string(client.Id())))

		// ── identify ────────────────────────────────────────────────────────
		client.On("identify", func(args ...interface{}) {
			if len(args) == 0 {
				return
			}
			data, ok := args[0].(map[string]interface{})
			if !ok {
				return
			}
			clientID := anyToString(data["clientId"])
			gameID := anyToString(data["gameId"])

			stateMu.Lock()
			activeConnections[client.Id()] = connectionInfo{ClientID: clientID, GameID: gameID}
			stateMu.Unlock()

			client.Join(sio.Room(gameID))
			logger.Info("ws identify",
				zap.String("id", string(client.Id())),
				zap.String("clientId", clientID),
				zap.String("gameId", gameID),
			)

			// Replay existing answer counts to the newly joined client
			stateMu.RLock()
			rooms, exists := gameRooms[gameID]
			stateMu.RUnlock()
			if exists {
				for qi, counts := range rooms {
					client.Emit("answer_counts", map[string]interface{}{
						"questionIndex": qi,
						"counts":        counts,
					})
				}
			}
		})

		// ── answer ──────────────────────────────────────────────────────────
		client.On("answer", func(args ...interface{}) {
			if len(args) == 0 {
				return
			}
			data, ok := args[0].(map[string]interface{})
			if !ok {
				return
			}

			questionIndex := int(toFloat64(data["questionIndex"]))
			gameID := anyToString(data["gameId"])
			if gameID == "" {
				stateMu.RLock()
				if conn, found := activeConnections[client.Id()]; found {
					gameID = conn.GameID
				}
				stateMu.RUnlock()
			}
			if gameID == "" {
				client.Emit("error", map[string]string{"message": "Not identified"})
				return
			}

			choices, _ := data["choices"].([]interface{})

			stateMu.Lock()
			if gameRooms[gameID] == nil {
				gameRooms[gameID] = make(map[int]map[int]int)
			}
			if gameRooms[gameID][questionIndex] == nil {
				gameRooms[gameID][questionIndex] = map[int]int{0: 0, 1: 0, 2: 0, 3: 0}
			}
			for _, c := range choices {
				ci := int(toFloat64(c))
				if ci >= 0 && ci <= 3 {
					gameRooms[gameID][questionIndex][ci]++
				}
			}
			counts := gameRooms[gameID][questionIndex]
			stateMu.Unlock()

			io.To(sio.Room(gameID)).Emit("answer_counts", map[string]interface{}{
				"questionIndex": questionIndex,
				"counts":        counts,
			})
		})

		// ── reset_question ───────────────────────────────────────────────────
		client.On("reset_question", func(args ...interface{}) {
			if len(args) == 0 {
				return
			}
			data, ok := args[0].(map[string]interface{})
			if !ok {
				return
			}
			questionIndex := int(toFloat64(data["questionIndex"]))

			stateMu.RLock()
			conn, connected := activeConnections[client.Id()]
			stateMu.RUnlock()
			if !connected {
				client.Emit("error", map[string]string{"message": "Not identified"})
				return
			}
			gameID := conn.GameID

			stateMu.Lock()
			if gameRooms[gameID] != nil {
				delete(gameRooms[gameID], questionIndex)
			}
			stateMu.Unlock()

			io.To(sio.Room(gameID)).Emit("question_reset", map[string]interface{}{
				"questionIndex": questionIndex,
			})
		})

		// ── disconnect ───────────────────────────────────────────────────────
		client.On("disconnect", func(args ...interface{}) {
			stateMu.Lock()
			conn, known := activeConnections[client.Id()]
			delete(activeConnections, client.Id())
			stateMu.Unlock()

			if known {
				logger.Info("ws disconnect",
					zap.String("id", string(client.Id())),
					zap.String("clientId", conn.ClientID),
					zap.String("gameId", conn.GameID),
				)
			} else {
				logger.Info("ws disconnect", zap.String("id", string(client.Id())))
			}
		})
	})

	return io
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

func main() {
	var err error
	logger, err = zap.NewDevelopment()
	if err != nil {
		panic(err)
	}
	defer logger.Sync() //nolint:errcheck

	if err = initDB(); err != nil {
		logger.Fatal("db init failed", zap.Error(err))
	}
	defer db.Close()

	io := setupSocketIO()

	mux := http.NewServeMux()

	// Viewer UI
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		content, _ := viewerHTML.ReadFile("templates/viewer.html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(content)
	})

	// Quiz API
	mux.HandleFunc("/api/question", handleQueryQuestion)
	mux.HandleFunc("/api/answer", handleSaveAnswer)

	// Socket.IO (handles its own CORS)
	mux.Handle("/api/socket.io/", io.ServeHandler(nil))

	// Internal management API
	mux.HandleFunc("/int/stats", handleStats)
	mux.HandleFunc("/int/questions", handleQuestions)
	mux.HandleFunc("/int/shutdown", handleShutdown)
	mux.HandleFunc("/int/cleanup", handleCleanup)

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: corsMiddleware(mux),
	}

	go func() {
		logger.Info("listening", zap.String("port", port))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server error", zap.Error(err))
		}
	}()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	logger.Info("shutting down")
	_ = db.Close()
}
