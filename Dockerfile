# Use official Node.js 20 on Debian (has apt-get for installing gcc)
FROM node:20-slim

# Install gcc, make, and other C build tools
RUN apt-get update && \
    apt-get install -y gcc make && \
    rm -rf /var/lib/apt/lists/*

# Set working directory to app root
WORKDIR /app

# Copy and install frontend dependencies, then build
COPY frontend/package*.json ./frontend/
RUN npm install --prefix ./frontend

COPY frontend/ ./frontend/
RUN npm run build --prefix ./frontend

# Copy and install backend dependencies
COPY backend/package*.json ./backend/
RUN npm install --prefix ./backend

COPY backend/ ./backend/

# Expose the port the server runs on
EXPOSE 5000

# Seed the DB then start the server
WORKDIR /app/backend
CMD node src/utils/seeder.js && node server.js
