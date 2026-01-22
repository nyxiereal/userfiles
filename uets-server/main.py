from flask import Flask, request, jsonify, render_template_string
from flask_socketio import SocketIO, emit, join_room, leave_room
from logging import basicConfig, getLogger, INFO
from flask_cors import CORS
import os
import sqlite3
from collections import defaultdict
import threading

app = Flask(__name__)
app.config["SECRET_KEY"] = "your-secret-key"
CORS(
    app,
    origins=[
        "https://wayground.com",
        "https://*.wayground.com",
        "https://quizizz.com",
        "https://*.quizizz.com",
        "https://*.kahoot.it",
        "https://kahoot.it",
    ],
)

socketio = SocketIO(app, cors_allowed_origins="*", path="/api/socket.io")

basicConfig(filename="uets-server.log", level=INFO)
logger = getLogger(__name__)
logger.setLevel(INFO)

DATABASE_PATH = os.path.join(os.getenv("DATA_DIR", "/app/data"), "quiz_data.db")
print(f"🗄️  Database path: {DATABASE_PATH}")

# Store active connections and their game data
active_connections = {}  # {session_id: {client_id, game_id}}
game_rooms = defaultdict(dict)  # {game_id: {question_index: {choice: count}}}


# Database initialization
def init_database():
    """Initialize the SQLite database with required tables"""
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS questions (
            question_id TEXT PRIMARY KEY,
            question_type TEXT,
            correct_answers TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    conn.commit()
    conn.close()


def get_db_connection():
    """Get a database connection"""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def get_question(question_id):
    """Get question data from database"""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM questions WHERE question_id = ?", (question_id,))
    result = cursor.fetchone()
    conn.close()

    return dict(result) if result else None


def save_question(question_id, question_type, correct_answers=None):
    """Save or update question in database"""
    conn = get_db_connection()
    cursor = conn.cursor()

    if correct_answers is not None:
        # Update existing question with correct answers
        cursor.execute(
            """
            UPDATE questions 
            SET correct_answers = ?, updated_at = CURRENT_TIMESTAMP
            WHERE question_id = ?
        """,
            (str(correct_answers), question_id),
        )
    else:
        # Insert new question or ignore if exists
        cursor.execute(
            """
            INSERT OR IGNORE INTO questions (question_id, question_type)
            VALUES (?, ?)
        """,
            (question_id, question_type),
        )

    conn.commit()
    conn.close()


@socketio.on("connect")
def handle_connect():
    logger.info(f"Client connected: {request.sid}")
    print(f"🔌 Client connected: {request.sid}")


@socketio.on("disconnect")
def handle_disconnect():
    session_id = request.sid
    if session_id in active_connections:
        game_id = active_connections[session_id]["game_id"]
        leave_room(game_id)
        del active_connections[session_id]
        logger.info(f"Client disconnected: {session_id}")
        print(f"📴 Client disconnected: {session_id}")


@socketio.on("identify")
def handle_identify(data):
    session_id = request.sid
    client_id = data.get("clientId")
    game_id = data.get("gameId")

    if not client_id or not game_id:
        emit("error", {"message": "Client ID and Game ID required"})
        return

    # Store connection info
    active_connections[session_id] = {"client_id": client_id, "game_id": game_id}

    # Join game room
    join_room(game_id)

    logger.info(f"Client identified: {client_id} in game {game_id}")
    print(f"📝 Client {client_id} joined game {game_id}")

    # Send current answer counts for this game
    if game_id in game_rooms:
        for question_index, counts in game_rooms[game_id].items():
            emit("answer_counts", {"questionIndex": question_index, "counts": counts})


@socketio.on("answer")
def handle_answer(data):
    session_id = request.sid
    if session_id not in active_connections:
        emit("error", {"message": "Not identified"})
        return

    connection_info = active_connections[session_id]
    game_id = connection_info["game_id"]
    client_id = connection_info["client_id"]

    question_index = data.get("questionIndex")
    choices = data.get("choices", [])

    if question_index is None or not choices:
        emit("error", {"message": "Question index and choices required"})
        return

    # Initialize question data if not exists
    if question_index not in game_rooms[game_id]:
        game_rooms[game_id][question_index] = {0: 0, 1: 0, 2: 0, 3: 0}

    # Update answer counts
    for choice in choices:
        if 0 <= choice <= 3:
            game_rooms[game_id][question_index][choice] += 1

    logger.info(f"Answer received from {client_id}: Q{question_index} = {choices}")
    print(f"🎯 Answer from {client_id}: Q{question_index} = {choices}")

    # Broadcast updated counts to all clients in the game
    socketio.emit(
        "answer_counts",
        {
            "questionIndex": question_index,
            "counts": game_rooms[game_id][question_index],
        },
        room=game_id,
    )


@socketio.on("reset_question")
def handle_reset_question(data):
    session_id = request.sid
    if session_id not in active_connections:
        emit("error", {"message": "Not identified"})
        return

    connection_info = active_connections[session_id]
    game_id = connection_info["game_id"]
    question_index = data.get("questionIndex")

    if question_index is not None and game_id in game_rooms:
        if question_index in game_rooms[game_id]:
            del game_rooms[game_id][question_index]

        # Broadcast reset to all clients in the game
        socketio.emit("question_reset", {"questionIndex": question_index}, room=game_id)


@app.route("/api/question", methods=["POST"])
def handle_question():
    data = request.get_json()
    question_id = data.get("questionId")
    question_type = data.get("questionType")

    logger.info(f"Received question data for qid {question_id}")

    if not question_id:
        return jsonify({"error": "Question ID required"}), 400

    # Get or create question
    question_data = get_question(question_id)

    if not question_data:
        # Create new question
        save_question(question_id, question_type)
        question_data = {
            "question_id": question_id,
            "question_type": question_type,
            "correct_answers": None,
        }

    # Parse correct_answers from string if it exists
    correct_answers = None
    if question_data.get("correct_answers"):
        try:
            correct_answers = eval(question_data["correct_answers"])
        except:
            correct_answers = question_data["correct_answers"]

    return jsonify(
        {
            "hasAnswer": correct_answers is not None,
            "correctAnswers": correct_answers,
            "questionType": question_data.get("question_type"),
        }
    )


@app.route("/api/answer", methods=["POST"])
def submit_answer():
    data = request.get_json()
    question_id = data.get("questionId")
    correct_answers = data.get("correctAnswers")

    if not question_id or correct_answers is None:
        return jsonify({"error": "Question ID and correct answers required"}), 400

    question_data = get_question(question_id)

    if not question_data:
        # Create the question with answer if it doesn't exist
        save_question(question_id, None, correct_answers)
        return jsonify({"success": True})

    # Check if answer already exists
    if question_data.get("correct_answers"):
        return jsonify({"error": "Answer already set"}), 403

    # Save the correct answer
    save_question(question_id, question_data["question_type"], correct_answers)

    return jsonify({"success": True})


@app.route("/int/stats", methods=["GET"])
def get_stats():
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) as total FROM questions")
    total_questions = cursor.fetchone()["total"]

    cursor.execute(
        "SELECT COUNT(*) as answered FROM questions WHERE correct_answers IS NOT NULL"
    )
    answered_questions = cursor.fetchone()["answered"]

    conn.close()

    return jsonify(
        {
            "totalQuestions": total_questions,
            "answeredQuestions": answered_questions,
            "unansweredQuestions": total_questions - answered_questions,
        }
    )


@app.route("/int/questions", methods=["GET"])
def get_all_questions():
    """Get all questions from database"""
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute(
        "SELECT question_id, question_type, correct_answers, created_at, updated_at FROM questions ORDER BY updated_at DESC"
    )
    questions = cursor.fetchall()

    conn.close()

    questions_list = []
    for q in questions:
        correct_answers = None
        if q["correct_answers"]:
            try:
                correct_answers = eval(q["correct_answers"])
            except:
                correct_answers = q["correct_answers"]

        questions_list.append(
            {
                "questionId": q["question_id"],
                "questionType": q["question_type"],
                "correctAnswers": correct_answers,
                "createdAt": q["created_at"],
                "updatedAt": q["updated_at"],
            }
        )

    return jsonify(questions_list)


@app.route("/int/shutdown", methods=["POST"])
def shutdown():
    """Shutdown endpoint for graceful server termination"""
    logger.info("Shutdown request received")
    print("🔴 Shutdown request received")

    def shutdown_server():
        # Give a moment for the response to be sent
        threading.Timer(1.0, lambda: os._exit(0)).start()

    shutdown_server()
    return jsonify({"message": "Server shutting down..."}), 200

@app.route("/int/cleanup", methods=["POST"])
def cleanup_unanswered():
    """Remove all questions without correct answers from database"""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Count unanswered questions before deletion
    cursor.execute(
        "SELECT COUNT(*) as count FROM questions WHERE correct_answers IS NULL"
    )
    count_before = cursor.fetchone()["count"]

    # Delete unanswered questions
    cursor.execute("DELETE FROM questions WHERE correct_answers IS NULL")
    deleted_count = cursor.rowcount

    conn.commit()
    conn.close()

    logger.info(f"Cleanup: Removed {deleted_count} unanswered questions")
    print(f"🧹 Cleanup: Removed {deleted_count} unanswered questions")

    return jsonify(
        {"success": True, "deletedCount": deleted_count, "countBefore": count_before}
    )


@app.route("/")
def viewer():
    """HTML viewer for questions database"""
    html = """
<!DOCTYPE html>
<html>
<head>
    <title>UETS Database Viewer</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1e1e2e;
            color: #cdd6f4;
            padding: 20px;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        
        header {
            background: #313244;
            padding: 20px;
            border-radius: 12px;
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        h1 {
            color: #cba6f7;
            font-size: 24px;
        }
        
        .stats {
            display: flex;
            gap: 20px;
            margin: 20px 0;
        }
        
        .stat-card {
            background: #313244;
            padding: 15px 20px;
            border-radius: 8px;
            flex: 1;
        }
        
        .stat-label {
            color: #a6adc8;
            font-size: 12px;
            text-transform: uppercase;
            margin-bottom: 5px;
        }
        
        .stat-value {
            font-size: 28px;
            font-weight: bold;
            color: #cba6f7;
        }
        
        .controls {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }
        
        button {
            background: #cba6f7;
            color: #1e1e2e;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 500;
            transition: all 0.2s;
        }
        
        button:hover {
            background: #b4a0e5;
            transform: translateY(-1px);
        }
        
        button.danger {
            background: #f38ba8;
        }
        
        button.danger:hover {
            background: #e17899;
        }
        
        button:disabled {
            background: #45475a;
            color: #6c7086;
            cursor: not-allowed;
            transform: none;
        }
        
        .search-box {
            flex: 1;
            padding: 10px 15px;
            background: #313244;
            border: 1px solid #45475a;
            border-radius: 8px;
            color: #cdd6f4;
            font-size: 14px;
        }
        
        .search-box:focus {
            outline: none;
            border-color: #cba6f7;
        }
        
        .questions-table {
            background: #313244;
            border-radius: 12px;
            overflow: hidden;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
        }
        
        thead {
            background: #45475a;
        }
        
        th {
            padding: 15px;
            text-align: left;
            font-weight: 600;
            color: #cba6f7;
            font-size: 14px;
            text-transform: uppercase;
        }
        
        td {
            padding: 15px;
            border-top: 1px solid #45475a;
        }
        
        tr:hover {
            background: #45475a33;
        }
        
        .question-id {
            font-family: monospace;
            color: #89dceb;
            font-size: 12px;
        }
        
        .question-type {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .type-mcq { background: #a6e3a133; color: #a6e3a1; }
        .type-msq { background: #74c7ec33; color: #74c7ec; }
        .type-blank { background: #f9e2af33; color: #f9e2af; }
        
        .answer {
            font-family: monospace;
            font-size: 13px;
            color: #a6e3a1;
        }
        
        .no-answer {
            color: #6c7086;
            font-style: italic;
        }
        
        .timestamp {
            font-size: 12px;
            color: #a6adc8;
        }
        
        .loading {
            text-align: center;
            padding: 40px;
            color: #a6adc8;
        }
        
        .empty {
            text-align: center;
            padding: 60px;
            color: #6c7086;
        }
        
        .status {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #313244;
            padding: 10px 15px;
            border-radius: 8px;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #a6e3a1;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>UETS</h1>
            <div style="display: flex; gap: 10px;">
                <button onclick="loadData()" id="refreshBtn">Refresh</button>
                <button class="warning" onclick="cleanupDatabase()" id="cleanupBtn">Cleanup Unanswered</button>
                <button class="danger" onclick="shutdownServer()" id="shutdownBtn">Shutdown Server</button>
            </div>
        </header>
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-label">Total Questions</div>
                <div class="stat-value" id="totalQuestions">-</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Answered</div>
                <div class="stat-value" id="answeredQuestions">-</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Unanswered</div>
                <div class="stat-value" id="unansweredQuestions">-</div>
            </div>
        </div>
        
        <div class="controls">
            <input type="text" class="search-box" id="searchBox" placeholder="Search by Question ID...">
        </div>
        
        <div class="questions-table">
            <table>
                <thead>
                    <tr>
                        <th>Question ID</th>
                        <th>Type</th>
                        <th>Correct Answer(s)</th>
                        <th>Created</th>
                        <th>Updated</th>
                    </tr>
                </thead>
                <tbody id="questionsBody">
                    <tr><td colspan="5" class="loading">Loading...</td></tr>
                </tbody>
            </table>
        </div>
    </div>
    
    <script>
        let allQuestions = [];
        
        async function loadData() {
            try {
                // Load stats
                const statsRes = await fetch('/int/stats');
                const stats = await statsRes.json();
                document.getElementById('totalQuestions').textContent = stats.totalQuestions;
                document.getElementById('answeredQuestions').textContent = stats.answeredQuestions;
                document.getElementById('unansweredQuestions').textContent = stats.unansweredQuestions;
                
                // Load questions
                const questionsRes = await fetch('/int/questions');
                allQuestions = await questionsRes.json();
                renderQuestions(allQuestions);
            } catch (error) {
                console.error('Failed to load data:', error);
                document.getElementById('questionsBody').innerHTML = 
                    '<tr><td colspan="5" class="empty">Failed to load data</td></tr>';
            }
        }
        
        function renderQuestions(questions) {
            const tbody = document.getElementById('questionsBody');
            
            if (questions.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="empty">No questions found</td></tr>';
                return;
            }
            
            tbody.innerHTML = questions.map(q => {
                const typeClass = q.questionType ? 
                    `type-${q.questionType.toLowerCase()}` : 'type-mcq';
                const typeText = q.questionType || 'Unknown';
                
                const answerText = q.correctAnswers !== null ?
                    `<span class="answer">${JSON.stringify(q.correctAnswers)}</span>` :
                    '<span class="no-answer">Not answered yet</span>';
                
                const created = new Date(q.createdAt).toLocaleString();
                const updated = new Date(q.updatedAt).toLocaleString();
                
                return `
                    <tr>
                        <td><span class="question-id">${q.questionId}</span></td>
                        <td><span class="question-type ${typeClass}">${typeText}</span></td>
                        <td>${answerText}</td>
                        <td><span class="timestamp">${created}</span></td>
                        <td><span class="timestamp">${updated}</span></td>
                    </tr>
                `;
            }).join('');
        }
        
        function filterQuestions(searchTerm) {
            const filtered = allQuestions.filter(q => 
                q.questionId.toLowerCase().includes(searchTerm.toLowerCase())
            );
            renderQuestions(filtered);
        }
        
        async function cleanupDatabase() {
            // Get current unanswered count
            const statsRes = await fetch('/int/stats');
            const stats = await statsRes.json();
            const unansweredCount = stats.unansweredQuestions;
            
            if (unansweredCount === 0) {
                alert('No unanswered questions to clean up!');
                return;
            }
            
            if (!confirm(`Are you sure you want to delete ${unansweredCount} unanswered question(s)? This cannot be undone.`)) {
                return;
            }
            
            const btn = document.getElementById('cleanupBtn');
            btn.disabled = true;
            btn.textContent = 'Cleaning up...';
            
            try {
                const response = await fetch('/int/cleanup', { method: 'POST' });
                const result = await response.json();
                
                if (result.success) {
                    alert(`Successfully deleted ${result.deletedCount} unanswered question(s)`);
                    await loadData(); // Reload data to reflect changes
                } else {
                    alert('Cleanup failed');
                }
            } catch (error) {
                console.error('Cleanup failed:', error);
                alert('Cleanup failed: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.textContent = 'Cleanup Unanswered';
            }
        }
        
        async function shutdownServer() {
            if (!confirm('Are you sure you want to shutdown the server?')) {
                return;
            }
            
            const btn = document.getElementById('shutdownBtn');
            btn.disabled = true;
            btn.textContent = 'Shutting down...';
            
            try {
                await fetch('/int/shutdown', { method: 'POST' });
                alert('Server shutdown initiated');
            } catch (error) {
                console.error('Shutdown failed:', error);
            }
        }
        
        // Event listeners
        document.getElementById('searchBox').addEventListener('input', (e) => {
            filterQuestions(e.target.value);
        });
        
        // Initial load
        loadData();
    </script>
</body>
</html>
    """
    return render_template_string(html)


# Initialize database on startup
init_database()
logger.info("Database initialized")
print("💾 Database initialized")
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)