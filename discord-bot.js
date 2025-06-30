const { Client, GatewayIntentBits, Partials } = require('discord.js');
const dotenv = require('dotenv');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

dotenv.config();

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel],
});

// Initialize Gemini
const genai = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genai.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Bad words and their patterns
const badWords = [
  { word: 'fuck', regex: /\bf[u*][c*][k*]\b/i },
  { word: 'sex', regex: /\bs[e*][x*][y*]?\b/i },
  { word: 'motherfucker', regex: /\bm[o*][t*][h*][e*][r*][f*][u*][c*][k*][e*][r*]\b/i },
  { word: 'shit', regex: /\bs[h*][i*][t*]\b/i },
];

// Session tracking
const userWarnings = new Map();           // Tracks bad message strikes (up to 3)
const dmSessions = new Map();             // Tracks active DM therapy users
const userHistories = new Map();          // Stores last 10 DM messages per user

// On bot ready
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// Slash command: /ping
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  if (interaction.commandName === 'ping') {
    const latency = Math.round(client.ws.ping);
    await interaction.reply(`Pong! Latency: ${latency}ms`);
  }
});

// Register slash command
client.on('ready', async () => {
  try {
    await client.application.commands.create({
      name: 'ping',
      description: 'Check latency',
    });
    console.log('✅ Slash command /ping registered.');
  } catch (err) {
    console.error('❌ Failed to register slash command:', err);
  }
});

// Handle incoming messages (DMs and Guild)
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // === Handle Active Therapy DM ===
  if (message.channel.type === 1 && dmSessions.has(message.author.id)) {
    const userId = message.author.id;
    const content = message.content.trim();

    // End session on 'exit'
    if (content.toLowerCase() === 'exit') {
      dmSessions.delete(userId);
      userHistories.delete(userId);
      return message.channel.send("🫂 Session closed. You're always welcome to talk again. Take care!");
    }

    // Add to user history
    const history = userHistories.get(userId) || [];
    history.push(`User: ${content}`);
    if (history.length > 10) history.shift(); // keep last 10
    userHistories.set(userId, history);

    // Send to Gemini
    try {
      const prompt = history.join('\n') + `\nTherapist:`;
      const result = await model.generateContent(prompt);
      const response = result.response.text();

      history.push(`Therapist: ${response}`);
      if (history.length > 10) history.shift();
      userHistories.set(userId, history);

      return message.channel.send(response);
    } catch (err) {
      console.error('Gemini error:', err);
      return message.channel.send("I'm having trouble responding right now.");
    }
  }

  // === Handle Guild Message Filtering ===
  const content = message.content.toLowerCase();
  let isInappropriate = false;

  for (const { regex } of badWords) {
    if (regex.test(content)) {
      isInappropriate = true;
      break;
    }
  }

  if (isInappropriate) {
    const userId = message.author.id;
    try {
      await message.delete();

      const warnings = userWarnings.get(userId) || 0;
      const newCount = warnings + 1;
      userWarnings.set(userId, newCount);

      await message.channel.send(
        `${message.author}, your message was removed for inappropriate language. Warning ${newCount}/3.`
      );

      if (newCount >= 3) {
        userWarnings.set(userId, 0); // reset strike count

        try {
          const dm = await message.author.send(
            `👋 Hey, I noticed you've had a few rough moments. I'm here to talk privately. Just reply to this message and type \`exit\` anytime to end our chat. 🤖`
          );
          dmSessions.set(userId, true);
          userHistories.set(userId, []); // start fresh DM history
        } catch (err) {
          console.warn(`⚠️ Could not DM ${message.author.tag}.`, err);
          await message.channel.send(`${message.author}, I tried to DM you but couldn't. Please check your privacy settings.`);
        }
      }
    } catch (err) {
      console.error(`❌ Error handling message from ${message.author.tag}:`, err);
    }
  }
});

// Login to Discord
client.login(process.env.DISCORD_BOT_TOKEN);
