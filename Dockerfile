FROM node:18-alpine

WORKDIR /app

# Copy package files first (better build caching)
COPY package.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

# Render sets PORT automatically; app also defaults to 3000 if not set
EXPOSE 3000

CMD ["npm", "start"]
