import os
from google import genai
from flask import Flask, request, jsonify
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# Initialize the NEW Google GenAI Client (Latest SDK)
api_key = os.environ.get("GEMINI_API_KEY")
client = genai.Client(api_key=api_key)

@app.route("/chat", methods=["POST"])
def chat():
    try:
        data = request.get_json()
        user_message = data.get("message", "")

        if not user_message:
            return jsonify({"error": "No message provided"}), 400

        # Use the confirmed working model pointer
        response = client.models.generate_content(
            model="gemini-flash-latest",
            contents=user_message
        )

        if not response.text:
            return jsonify({"error": "Model returned empty response"}), 500

        return jsonify({
            "reply": response.text
        })
    except Exception as e:
        print(f"Error in /chat: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route("/", methods=["GET"])
def health():
    return jsonify({"status": "ready"}), 200

if __name__ == "__main__":
    # Disable debug/reloader to prevent threading exceptions in some Windows terminals
    app.run(host="127.0.0.1", port=5000, debug=False)
