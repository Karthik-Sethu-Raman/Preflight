FROM python:3.11-slim

# Install system dependencies including wget and unzip for Terraform
RUN apt-get update && apt-get install -y wget unzip && rm -rf /var/lib/apt/lists/*

# Install Terraform CLI
RUN wget https://releases.hashicorp.com/terraform/1.5.7/terraform_1.5.7_linux_amd64.zip \
    && unzip terraform_1.5.7_linux_amd64.zip \
    && mv terraform /usr/local/bin/ \
    && rm terraform_1.5.7_linux_amd64.zip

# Set working directory
WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code and override.tf
COPY *.py .
COPY override.tf .

# Expose the port Uvicorn runs on
EXPOSE 8000

# Command to run the FastAPI backend
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
