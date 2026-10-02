const express = require('express');
const multer = require('multer');
const { users } = require('./store');

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.fixture-token';
const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());

function requireAuth(req, res, next) {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return res.status(401).json({ message: 'Unauthorized' });
  next();
}

/**
 * Sign in and receive an access token.
 */
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'username and password are required' });
  }
  res.json({ access_token: TOKEN, token_type: 'bearer' });
});

/**
 * List all users.
 */
app.get('/api/users', requireAuth, (req, res) => {
  res.json(users);
});

/**
 * Create a user.
 */
app.post('/api/users', requireAuth, (req, res) => {
  const { name, email } = req.body;
  const user = { id: users.length + 1, name, email };
  users.push(user);
  res.status(201).json(user);
});

/**
 * Get a user by id.
 */
app.get('/api/users/:id', requireAuth, (req, res) => {
  const user = users.find((u) => u.id === Number(req.params.id));
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }
  res.json(user);
});

/**
 * Upload a user's avatar.
 */
app.post('/api/users/:id/avatar', requireAuth, upload.single('avatar'), (req, res) => {
  res.status(201).json({ id: Number(req.params.id), file: req.file ? req.file.originalname : null, size: req.file ? req.file.size : 0 });
});

module.exports = { app };
