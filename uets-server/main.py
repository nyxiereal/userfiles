from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from logging import basicConfig, getLogger, INFO
from flask_cors import CORS
import json
import os
from datetime import datetime
from collections import defaultdict

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

socketio = SocketIO(app, cors_allowed_origins="*")

basicConfig(filename="uets-server.log", level=INFO)
logger = getLogger(__name__)
logger.setLevel(INFO)

DATA_FILE = os.getenv("DATA_FILE", "quiz_data.json")
BLACKLIST_FILE = os.getenv("BLACKLIST_FILE", "ip_blacklist.json")

# Store active connections and their game data
active_connections = {}  # {session_id: {client_id, game_id}}
game_rooms = defaultdict(dict)  # {game_id: {question_index: {choice: count}}}


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


# Keep existing HTTP endpoints
@app.route("/api/question", methods=["POST"])
def handle_question():
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
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
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
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
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
