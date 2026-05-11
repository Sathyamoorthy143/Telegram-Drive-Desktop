import os
import google.generativeai as genai
from flask import Flask, request, jsonify
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# Initialize the Google Generative AI with the API key from environment
api_key = os.environ.get("GEMINI_API_KEY")
if not api_key:
    print("WARNING: GEMINI_API_KEY not found in .env file")
else:
    genai.configure(api_key=api_key)

@app.route("/chat", methods=["POST"])
def chat():
    try:
        data = request.get_json()
        user_message = data.get("message", "")

        if not user_message:
            return jsonify({"error": "No message provided"}), 400

        # Use the stable gemini-1.5-flash model which has better free-tier support
        model = genai.GenerativeModel("gemini-1.5-flash")
        
        # Generate the response
        response = model.generate_content(user_message)

        if not response.text:
            return jsonify({"error": "Model returned empty response"}), 500

        return jsonify({
            "reply": response.text
        })
    except Exception as e:
        print(f"Error in /chat: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route("/", methods=["GET"])
def health_check():
    return jsonify({"status": "healthy", "model": "gemini-1.5-flash"}), 200

if __name__ == "__main__":
    # Ensure it runs on 127.0.0.1:5000 as expected by the Tauri app
    app.run(host="127.0.0.1", port=5000, debug=True)
