FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source
COPY . .

# Expose port (Render uses PORT env var)
EXPOSE 4177

# Set environment
ENV PORT=4177
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

# Start the server
CMD ["npm", "run", "config:web"]
