require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

const app = express();

// ========== DADOS DOS ITENS ==========
const DATA_FILE = path.join('/tmp', 'items.json');

const DEFAULT_ITEMS = [
  { id: 1, name: 'Bot de Comandos', category: 'comandos', price: 'R$ 50,00', stock: 5, logo: '⚙️' },
  { id: 2, name: 'Bot de Utilidades', category: 'utilidades', price: 'R$ 35,00', stock: 3, logo: '🔧' },
  { id: 3, name: 'Bot de Boas Vindas', category: 'boas-vindas', price: 'R$ 45,00', stock: 7, logo: '👋' },
  { id: 4, name: 'Bot de Moderação', category: 'moderacao', price: 'R$ 60,00', stock: 2, logo: '🛡️' },
  { id: 5, name: 'Bot de Música', category: 'musica', price: 'R$ 40,00', stock: 4, logo: '🎵' },
  { id: 6, name: 'Bot de Economia', category: 'economia', price: 'R$ 55,00', stock: 1, logo: '💰' },
  { id: 7, name: 'Bot de Diversão', category: 'diversao', price: 'R$ 30,00', stock: 8, logo: '🎮' },
  { id: 8, name: 'Bot de Suporte', category: 'suporte', price: 'R$ 25,00', stock: 6, logo: '🎯' }
];

function loadItems() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Erro ao ler items.json:', e.message);
  }
  saveItems(DEFAULT_ITEMS);
  return DEFAULT_ITEMS;
}

function saveItems(items) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2), 'utf-8');
  } catch (e) {
    console.error('Erro ao salvar items.json:', e.message);
  }
}

// ========== MIDDLEWARES ==========
app.use(helmet({
  hidePoweredBy: true,
  frameguard: { action: 'deny' },
  xssFilter: true,
  noSniff: true,
  ieNoOpen: true,
  contentSecurityPolicy: false
}));

app.use(cors({
  origin: '*',
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== SESSÃO ==========
app.use(session({
  secret: process.env.SESSION_SECRET || 'ctc_estoque_secret_2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// ========== ARQUIVOS ESTÁTICOS ==========
app.use(express.static(path.join(__dirname, '../public')));

// ========== ROTAS ==========

app.get('/auth/discord', (req, res) => {
  const redirectUri = process.env.REDIRECT_URI || `https://${req.get('host')}/auth/discord/callback`;
  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify'
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    return res.redirect('/?error=no_code');
  }

  try {
    const redirectUri = process.env.REDIRECT_URI || `https://${req.get('host')}/auth/discord/callback`;
    
    const tokenResponse = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token } = tokenResponse.data;

    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const user = userResponse.data;
    const ownerIds = process.env.OWNER_IDS ? process.env.OWNER_IDS.split(',').map(id => id.trim()) : [];
    const isOwner = ownerIds.includes(user.id);

    req.session.user = {
      id: user.id,
      username: user.username,
      global_name: user.global_name || user.username,
      avatar: user.avatar,
      discriminator: user.discriminator
    };
    req.session.isOwner = isOwner;

    res.redirect('/');
  } catch (error) {
    console.error('❌ Erro no callback Discord:', error.response?.data || error.message);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.get('/api/user', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  res.json({
    user: req.session.user,
    isOwner: req.session.isOwner || false
  });
});

app.get('/api/items', (req, res) => {
  const items = loadItems();
  res.json(items);
});

app.post('/api/items', (req, res) => {
  if (!req.session.isOwner) {
    return res.status(403).json({ error: 'Apenas proprietários podem gerenciar itens' });
  }

  const { action, item } = req.body;
  let items = loadItems();

  if (action === 'add') {
    const newItem = { ...item, id: Date.now() };
    items.push(newItem);
    saveItems(items);
    return res.json({ success: true, item: newItem });
  }

  if (action === 'edit') {
    const index = items.findIndex(i => i.id === item.id);
    if (index === -1) return res.status(404).json({ error: 'Item não encontrado' });
    items[index] = { ...items[index], ...item };
    saveItems(items);
    return res.json({ success: true, item: items[index] });
  }

  if (action === 'delete') {
    items = items.filter(i => i.id !== item.id);
    saveItems(items);
    return res.json({ success: true });
  }

  if (action === 'buy') {
    const index = items.findIndex(i => i.id === item.id);
    if (index === -1) return res.status(404).json({ error: 'Item não encontrado' });
    if (items[index].stock <= 0) return res.status(400).json({ error: 'Sem estoque' });
    items[index].stock--;
    saveItems(items);
    return res.json({ success: true, item: items[index] });
  }

  res.status(400).json({ error: 'Ação inválida' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

module.exports = app;
