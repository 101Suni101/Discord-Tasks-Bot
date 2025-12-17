// src/index.js
const { Client, GatewayIntentBits, Events, REST, Routes } = require("discord.js");
const CONFIG = require("../config/config");
const DB = require("./models/spreadsheet");
const Reminder = require("./services/reminder");
const InteractionCtrl = require("./controllers/interaction");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- INIT ---
client.once(Events.ClientReady, async () => {
    console.log(`🔥 Bot ${client.user.tag} Online!`);
    await DB.init(); // Load Excel
    Reminder.start(client); // Start Loop
});

// --- ROUTER ---
client.on(Events.InteractionCreate, async i => {
    try {
        if (i.isChatInputCommand()) await InteractionCtrl.handleCommand(i, client);
        else if (i.isAutocomplete()) {
            // Logic Autocomplete Title/Role disini
            // Gunakan DB.state.titles dan DB.state.roles
            const focused = i.options.getFocused(true);
            if (focused.name === 'title') {
                // ... filter DB.state.titles
            }
        }
        else if (i.isModalSubmit()) await InteractionCtrl.handleModal(i, client);
        else if (i.isButton()) await InteractionCtrl.handleButton(i, client);
        else if (i.isStringSelectMenu()) {
            // Handle menu cancel/stop disini (pindahkan logic dari interaction controller jika mau)
        }
    } catch (e) { console.error(e); }
});

// --- DEPLOY COMMANDS (Opsional: Bisa dipisah file sendiri) ---
// (Copy logic deploy commands kamu disini)
// ...

client.login(CONFIG.TOKEN);