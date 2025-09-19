from flask import Flask, request, jsonify
from logging import basicConfig, getLogger, INFO
from flask_cors import CORS  # type: ignore
import json
import os
from datetime import datetime

app = Flask(__name__)
CORS(
    app,
    origins=[
        "https://wayground.com",
        "https://*.wayground.com",
        "https://quizizz.com",
        "https://*.quizizz.com",
    ],
)

basicConfig(filename="uets-server.log", level=INFO)
logger = getLogger(__name__)
logger.setLevel(INFO)

DATA_FILE = "quiz_data.json"
BLACKLIST_FILE = "ip_blacklist.json"

def load_data():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def save_data(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def load_blacklist():
    if os.path.exists(BLACKLIST_FILE):
        with open(BLACKLIST_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []

def save_blacklist(blacklist):
    with open(BLACKLIST_FILE, "w", encoding="utf-8") as f:
        json.dump(blacklist, f, indent=2, ensure_ascii=False)

@app.route("/api/question", methods=["POST"])
def handle_question():
    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    data = request.get_json()
    question_id = data.get("questionId")
    question_type = data.get("questionType")
    answer_ids = data.get("answerIds", [])
    logger.info(f"Received question data for qid {question_id}")

    if not question_id:
        return jsonify({"error": "Question ID required"}), 400

    quiz_data = load_data()

    if question_id not in quiz_data:
        quiz_data[question_id] = {
            "questionType": question_type,
            "answerIds": answer_ids,
            "correctAnswers": None,
            "created": datetime.now().isoformat(),
            "ips": [],
        }
    if "ips" not in quiz_data[question_id]:
        quiz_data[question_id]["ips"] = []
    if client_ip not in quiz_data[question_id]["ips"]:
        quiz_data[question_id]["ips"].append(client_ip)
    save_data(quiz_data)

    question_data = quiz_data[question_id]
    return jsonify(
        {
            "hasAnswer": question_data.get("correctAnswers") is not None,
            "correctAnswers": question_data.get("correctAnswers"),
            "questionType": question_data.get("questionType"),
        }
    )

@app.route("/api/answer", methods=["POST"])
def submit_answer():
    client_ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    data = request.get_json()
    question_id = data.get("questionId")
    correct_answers = data.get("correctAnswers")

    if not question_id or correct_answers is None:
        return jsonify({"error": "Question ID and correct answers required"}), 400

    quiz_data = load_data()
    blacklist = load_blacklist()

    if question_id in quiz_data:
        if "ips" not in quiz_data[question_id]:
            quiz_data[question_id]["ips"] = []
        existing_answers = quiz_data[question_id].get("correctAnswers")
        if existing_answers is not None:
            if client_ip not in blacklist:
                blacklist.append(client_ip)
                save_blacklist(blacklist)
            return jsonify({"error": "Answer already set"}), 403
        quiz_data[question_id]["correctAnswers"] = correct_answers
        quiz_data[question_id]["updated"] = datetime.now().isoformat()
        if client_ip not in quiz_data[question_id]["ips"]:
            quiz_data[question_id]["ips"].append(client_ip)
        save_data(quiz_data)
        return jsonify({"success": True})

    return jsonify({"error": "Question not found"}), 404

@app.route("/api/stats", methods=["GET"])
def get_stats():
    quiz_data = load_data()
    total_questions = len(quiz_data)
    answered_questions = sum(
        1 for q in quiz_data.values() if q.get("correctAnswers") is not None
    )

    return jsonify(
        {
            "totalQuestions": total_questions,
            "answeredQuestions": answered_questions,
            "unansweredQuestions": total_questions - answered_questions,
        }
    )

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)