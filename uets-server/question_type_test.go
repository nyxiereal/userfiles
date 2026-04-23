package main

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func setupQuestionTypeTestDB(t *testing.T) *sql.DB {
	t.Helper()

	testDB, err := sql.Open("sqlite", "file:question_type_test?mode=memory&cache=shared")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}

	_, err = testDB.Exec(`CREATE TABLE questions (
		question_id     TEXT PRIMARY KEY,
		question_type   TEXT,
		correct_answers TEXT,
		created_at      TIMESTAMP,
		updated_at      TIMESTAMP
	)`)
	if err != nil {
		testDB.Close()
		t.Fatalf("create questions table: %v", err)
	}

	oldDB := db
	db = testDB
	t.Cleanup(func() {
		db = oldDB
		testDB.Close()
	})

	return testDB
}

func TestInferQuestionTypeFromStoredAnswer(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "numeric answer becomes mcq", raw: "1", want: "MCQ"},
		{name: "text answer becomes blank", raw: "paris", want: "BLANK"},
		{name: "numeric array becomes msq", raw: "[0, 2]", want: "MSQ"},
		{name: "empty array becomes open", raw: "[]", want: "OPEN"},
		{name: "structured mapping stays unresolved", raw: `[{"optionId":["a"],"targetId":"b"}]`, want: ""},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := inferQuestionTypeFromStoredAnswer(tc.raw)
			if got != tc.want {
				t.Fatalf("inferQuestionTypeFromStoredAnswer(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}

func TestInferQuestionTypeFromAnswerValue(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		value interface{}
		want  string
	}{
		{name: "numeric becomes mcq", value: float64(2), want: "MCQ"},
		{name: "text becomes blank", value: "17", want: "BLANK"},
		{name: "number array becomes msq", value: []interface{}{float64(0), float64(3)}, want: "MSQ"},
		{name: "empty array becomes open", value: []interface{}{}, want: "OPEN"},
		{name: "structured array stays unresolved", value: []interface{}{map[string]interface{}{"optionId": []interface{}{"a"}, "targetId": "b"}}, want: ""},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := inferQuestionTypeFromAnswerValue(tc.value)
			if got != tc.want {
				t.Fatalf("inferQuestionTypeFromAnswerValue(%#v) = %q, want %q", tc.value, got, tc.want)
			}
		})
	}
}

func TestResolveQuestionType(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		q           *dbQuestion
		requestType string
		want        string
	}{
		{
			name: "prefers stored type",
			q: &dbQuestion{
				QuestionType:   sql.NullString{String: "msq", Valid: true},
				CorrectAnswers: sql.NullString{String: "1", Valid: true},
			},
			requestType: "MCQ",
			want:        "MSQ",
		},
		{
			name: "uses request type when stored missing",
			q: &dbQuestion{
				CorrectAnswers: sql.NullString{String: "1", Valid: true},
			},
			requestType: "blank",
			want:        "BLANK",
		},
		{
			name: "falls back to inferred type",
			q: &dbQuestion{
				CorrectAnswers: sql.NullString{String: "[0, 2]", Valid: true},
			},
			requestType: "",
			want:        "MSQ",
		},
		{
			name:        "returns empty when nothing is known",
			q:           &dbQuestion{},
			requestType: "",
			want:        "",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got := resolveQuestionType(tc.q, tc.requestType)
			if got != tc.want {
				t.Fatalf("resolveQuestionType() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestBackfillQuestionTypeIfMissing(t *testing.T) {
	testDB := setupQuestionTypeTestDB(t)

	_, err := testDB.Exec(
		`INSERT INTO questions (question_id, question_type, correct_answers, created_at, updated_at)
		 VALUES ('missing', NULL, '1', '2026-04-23T09:13:24.391256', '2026-04-23T09:13:24.391256'),
		        ('existing', 'MSQ', '[0, 2]', '2026-04-23T09:13:24.391256', '2026-04-23T09:13:24.391256')`,
	)
	if err != nil {
		t.Fatalf("seed questions: %v", err)
	}

	if err := backfillQuestionTypeIfMissing("missing", sql.NullString{}, "MCQ"); err != nil {
		t.Fatalf("backfill missing question type: %v", err)
	}
	if err := backfillQuestionTypeIfMissing("existing", sql.NullString{String: "MSQ", Valid: true}, "MCQ"); err != nil {
		t.Fatalf("backfill existing question type: %v", err)
	}

	var missingType string
	if err := testDB.QueryRow(`SELECT question_type FROM questions WHERE question_id = 'missing'`).Scan(&missingType); err != nil {
		t.Fatalf("read missing row: %v", err)
	}
	if missingType != "MCQ" {
		t.Fatalf("missing row question_type = %q, want %q", missingType, "MCQ")
	}

	var existingType string
	if err := testDB.QueryRow(`SELECT question_type FROM questions WHERE question_id = 'existing'`).Scan(&existingType); err != nil {
		t.Fatalf("read existing row: %v", err)
	}
	if existingType != "MSQ" {
		t.Fatalf("existing row question_type = %q, want %q", existingType, "MSQ")
	}
}

func TestBackfillMissingQuestionTypesFromStoredAnswers(t *testing.T) {
	testDB := setupQuestionTypeTestDB(t)

	_, err := testDB.Exec(
		`INSERT INTO questions (question_id, question_type, correct_answers, created_at, updated_at)
		 VALUES
		    ('mcq', NULL, '1', '2026-04-23T09:13:24.391256', '2026-04-23T09:13:24.391256'),
		    ('msq', NULL, '[0, 2]', '2026-04-23T09:13:24.391256', '2026-04-23T09:13:24.391256'),
		    ('structured', NULL, '[{"optionId":["a"],"targetId":"b"}]', '2026-04-23T09:13:24.391256', '2026-04-23T09:13:24.391256'),
		    ('already-set', 'BLANK', 'paris', '2026-04-23T09:13:24.391256', '2026-04-23T09:13:24.391256')`,
	)
	if err != nil {
		t.Fatalf("seed questions: %v", err)
	}

	updated, err := backfillMissingQuestionTypesFromStoredAnswers()
	if err != nil {
		t.Fatalf("backfillMissingQuestionTypesFromStoredAnswers() error = %v", err)
	}
	if updated != 2 {
		t.Fatalf("backfillMissingQuestionTypesFromStoredAnswers() updated %d rows, want 2", updated)
	}

	rows, err := testDB.Query(`SELECT question_id, COALESCE(question_type, '') FROM questions ORDER BY question_id`)
	if err != nil {
		t.Fatalf("query questions: %v", err)
	}
	defer rows.Close()

	got := map[string]string{}
	for rows.Next() {
		var id, qType string
		if err := rows.Scan(&id, &qType); err != nil {
			t.Fatalf("scan row: %v", err)
		}
		got[id] = qType
	}

	want := map[string]string{
		"already-set": "BLANK",
		"mcq":         "MCQ",
		"msq":         "MSQ",
		"structured":  "",
	}
	for id, expected := range want {
		if got[id] != expected {
			t.Fatalf("question %s type = %q, want %q", id, got[id], expected)
		}
	}
}
