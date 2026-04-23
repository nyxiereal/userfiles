package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func normalizeQuestionType(questionType string) string {
	return strings.ToUpper(strings.TrimSpace(questionType))
}

func hasQuestionType(questionType sql.NullString) bool {
	return questionType.Valid && normalizeQuestionType(questionType.String) != ""
}

func inferQuestionTypeFromStoredAnswer(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "None" {
		return ""
	}

	return inferQuestionTypeFromAnswerValue(parseStoredAnswer(raw))
}

func inferQuestionTypeFromAnswerValue(answer interface{}) string {
	switch value := answer.(type) {
	case nil:
		return ""
	case float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, json.Number:
		return "MCQ"
	case string:
		return "BLANK"
	case []interface{}:
		if len(value) == 0 {
			return "OPEN"
		}
		if sliceContainsOnlyNumbers(value) {
			return "MSQ"
		}
		return ""
	default:
		return ""
	}
}

func sliceContainsOnlyNumbers(values []interface{}) bool {
	for _, value := range values {
		switch value.(type) {
		case float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, json.Number:
			continue
		default:
			return false
		}
	}
	return true
}

func resolveQuestionType(q *dbQuestion, requestType string) string {
	if q != nil && hasQuestionType(q.QuestionType) {
		return normalizeQuestionType(q.QuestionType.String)
	}

	if normalizedRequestType := normalizeQuestionType(requestType); normalizedRequestType != "" {
		return normalizedRequestType
	}

	if q != nil && q.CorrectAnswers.Valid {
		return inferQuestionTypeFromStoredAnswer(q.CorrectAnswers.String)
	}

	return ""
}

func backfillQuestionTypeIfMissing(questionID string, existingQuestionType sql.NullString, resolvedType string) error {
	resolvedType = normalizeQuestionType(resolvedType)
	if hasQuestionType(existingQuestionType) || resolvedType == "" {
		return nil
	}

	now := time.Now().UTC().Format("2006-01-02T15:04:05.999999")
	_, err := db.Exec(
		`UPDATE questions
		 SET question_type = ?, updated_at = ?
		 WHERE question_id = ? AND (question_type IS NULL OR TRIM(question_type) = '')`,
		resolvedType, now, questionID,
	)
	if err != nil {
		return fmt.Errorf("backfill question type for %s: %w", questionID, err)
	}
	return nil
}

func backfillMissingQuestionTypesFromStoredAnswers() (int, error) {
	rows, err := db.Query(
		`SELECT question_id, question_type, correct_answers
		 FROM questions
		 WHERE (question_type IS NULL OR TRIM(question_type) = '')
		   AND correct_answers IS NOT NULL`,
	)
	if err != nil {
		return 0, fmt.Errorf("query missing question types: %w", err)
	}
	defer rows.Close()

	type backfillCandidate struct {
		questionID string
		inferred   string
	}

	candidates := make([]backfillCandidate, 0)
	for rows.Next() {
		var questionID string
		var questionType sql.NullString
		var correctAnswers sql.NullString
		if err := rows.Scan(&questionID, &questionType, &correctAnswers); err != nil {
			return 0, fmt.Errorf("scan question for backfill: %w", err)
		}

		inferredType := inferQuestionTypeFromStoredAnswer(correctAnswers.String)
		if inferredType == "" {
			continue
		}
		candidates = append(candidates, backfillCandidate{
			questionID: questionID,
			inferred:   inferredType,
		})
	}

	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate questions for backfill: %w", err)
	}

	updated := 0
	for _, candidate := range candidates {
		if err := backfillQuestionTypeIfMissing(candidate.questionID, sql.NullString{}, candidate.inferred); err != nil {
			return updated, err
		}
		updated++
	}

	return updated, nil
}
