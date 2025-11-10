from flask import Flask, request, jsonify
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

socketio = SocketIO(app, cors_allowed_origins="*")

basicConfig(filename="uets-server.log", level=INFO)
logger = getLogger(__name__)
logger.setLevel(INFO)

DATABASE_PATH = os.getenv("DATABASE_PATH", "quiz_data.db")

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
        return jsonify({"error": "Question not found"}), 404

    # Check if answer already exists
    if question_data.get("correct_answers"):
        return jsonify({"error": "Answer already set"}), 403

    # Save the correct answer
    save_question(question_id, question_data["question_type"], correct_answers)

    return jsonify({"success": True})


@app.route("/api/stats", methods=["GET"])
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


@app.route("/shutdown", methods=["POST"])
def shutdown():
    """Shutdown endpoint for graceful server termination"""
    logger.info("Shutdown request received")
    print("🔴 Shutdown request received")

    def shutdown_server():
        # Give a moment for the response to be sent
        threading.Timer(1.0, lambda: os._exit(0)).start()

    shutdown_server()
    return jsonify({"message": "Server shutting down..."}), 200


# Initialize database on startup
init_database()
logger.info("Database initialized")
print("💾 Database initialized")
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5001, debug=True)
