const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

function generateSummary(task) {
    let lines = [];
    task.labels.forEach((label, idx) => {
        const i = idx.toString();
        if (task.completed.includes(i)) lines.push(`${label}: ${task.finishedBy[i] || "?"} (Selesai)`);
        else if (task.takenBy[i]) {
            const sisa = task.deadlines[i] ? Math.floor((task.deadlines[i] - Date.now())/60000) + "m" : "?";
            lines.push(`${label}: ${task.takenBy[i] || "?"} (Proses, Sisa: ${sisa})`);
        } else lines.push(`${label}: -`);
    });
    return lines.join("\n");
}

function createTaskEmbed(task) {
    const total = task.labels.length;
    const done = task.completed.length;
    const taken = Object.keys(task.takenBy).length;
    const remain = total - done;

    let color = "Green";
    let status = `🟢 Open (${remain}/${total})`;
    if (remain === 0) { color = "Blue"; status = "✅ All Completed"; }
    else if (taken > 0) { color = "Yellow"; status = `🟡 In Progress`; }

    let list = task.labels.map((lbl, idx) => {
        const i = idx.toString();
        if (task.completed.includes(i)) return `**${lbl}**: <@${task.finishedBy[i]}> ✅`;
        if (task.takenBy[i]) {
            const ts = task.deadlines[i] ? `<t:${Math.floor(task.deadlines[i]/1000)}:R>` : "No Timer";
            return `**${lbl}**: <@${task.takenBy[i]}> ⏳ (${ts})`;
        }
        return `**${lbl}**: ⚪ _(Kosong)_`;
    });

    return new EmbedBuilder()
        .setTitle(task.title)
        .setDescription(`${task.originalDesc}\n\n**⏱️ Waktu:** ${task.duration} Menit\n**💰 Reward:** ${task.pointValue} Poin\n**📋 Progress:**\n${list.join("\n")}`)
        .addFields({ name: "Status", value: status, inline: true })
        .setColor(color);
}

function createButtons(task, type = "INITIAL", targetIdx = null) {
    const rows = [];
    let currentRow = new ActionRowBuilder();

    task.labels.forEach((label, idx) => {
        let style = ButtonStyle.Secondary;
        let labelTxt = label;
        let cId = `take_${idx}`;
        const iStr = idx.toString();

        if (task.completed.includes(iStr)) {
            // Jika sudah selesai, button biasanya hilang atau disabled, tapi logic lama user membiarkannya
            // Kita skip render button yang sudah complete jika mau, atau biarkan statis
            style = ButtonStyle.Success;
            labelTxt = "DONE";
            cId = `disabled_${idx}`;
        } else if (task.takenBy[iStr]) {
            style = ButtonStyle.Primary;
            labelTxt = "Selesai";
            cId = `done_${idx}`;
        }

        const btn = new ButtonBuilder().setCustomId(cId).setLabel(labelTxt).setStyle(style);
        if (cId.startsWith('disabled')) btn.setDisabled(true);

        currentRow.addComponents(btn);
        if (currentRow.components.length === 5) { rows.push(currentRow); currentRow = new ActionRowBuilder(); }
    });
    if (currentRow.components.length > 0) rows.push(currentRow);
    return rows;
}

module.exports = { generateSummary, createTaskEmbed, createButtons };