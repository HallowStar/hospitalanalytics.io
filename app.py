# app.py (Final Code - Standard Flask Structure)

from flask import Flask, request, jsonify, send_from_directory, render_template
from werkzeug.utils import secure_filename
import pandas as pd
import os
from datetime import datetime
from flask_cors import CORS
import numpy as np

# --- CONFIGURATION ---
# Default Flask initialization expects templates/ directory
app = Flask(__name__)
CORS(app)
UPLOAD_FOLDER = 'temp_uploads'
CLEANED_FOLDER = 'static_cleaned_data'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(CLEANED_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['CLEANED_FOLDER'] = CLEANED_FOLDER

# --- 1. CORE DATA CLEANING FUNCTION ---


def clean_data_and_get_metrics(input_filepath):
    """
    Reads the raw file, applies cleaning logic, and calculates metrics.
    """
    df = pd.read_csv(input_filepath)

    # --- PANDAS CLEANING LOGIC ---
    df["Name"] = df["Name"].str.title().str.strip()
    df['Date of Admission'] = pd.to_datetime(df['Date of Admission'])
    df['Discharge Date'] = pd.to_datetime(df['Discharge Date'])

    standardize_column = ["Gender", "Medical Condition", "Doctor",
                          "Hospital", "Insurance Provider", "Admission Type"]
    for text in standardize_column:
        if text == "Hospital":
            df[text] = df[text].str.strip().str.replace(",", "", regex=False).str.replace(
                r"^And\s+", "", regex=True).str.replace(r"\s+And$", "", regex=True).str.title()
        else:
            df[text] = df[text].str.title().str.strip()

    # 4. Calculate Metrics
    total_billing = df['Billing Amount'].sum()
    total_records = len(df)
    total_doctors = df['Doctor'].nunique()
    total_hospitals = df['Hospital'].nunique()

    return df, {
        'total_records': total_records,
        'total_billing': f"${total_billing / 1e6:.1f}M",
        'total_doctors': total_doctors,
        'total_hospitals': total_hospitals
    }

# --- 2. ROOT ROUTE (Serves the HTML Dashboard) ---


@app.route('/')
def serve_dashboard():
    """Serves the index.html file from the required 'templates' directory."""
    return render_template('index.html')

# --- 3. API ENDPOINT (Handles Upload and Cleaning) ---


@app.route('/upload-and-clean', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    if file:
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        original_filename = secure_filename(file.filename)
        unique_filename = f"{timestamp}_{original_filename}"

        raw_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
        cleaned_filename = f"cleaned_{timestamp}.csv"
        cleaned_path = os.path.join(
            app.config['CLEANED_FOLDER'], cleaned_filename)

        try:
            file.save(raw_path)
            df_cleaned, metrics = clean_data_and_get_metrics(raw_path)

            # Save the cleaned DataFrame (index=True adds the row number)
            df_cleaned.to_csv(cleaned_path, index=True)

            return jsonify({
                'success': True,
                'cleaned_data_url': f'/static_data/{cleaned_filename}',
                'metrics': metrics
            })

        except Exception as e:
            print(f"--- ERROR DURING PROCESSING: {e} ---")
            return jsonify({'error': 'Processing failed', 'details': str(e)}), 500

        finally:
            if os.path.exists(raw_path):
                os.remove(raw_path)

# --- 4. STATIC DATA ROUTE (Serves the Cleaned CSV) ---


@app.route('/static_data/<filename>')
def serve_cleaned_data(filename):
    """Allows the JavaScript fetch API to retrieve the dynamically created CSV file."""
    return send_from_directory(app.config['CLEANED_FOLDER'], filename)


if __name__ == '__main__':
    print("Starting Flask server...")
    app.run(debug=True, port=5000)
