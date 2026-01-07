module.exports = {
  apps : [{
    name: "SoulscansBot",
    script: "./src/index.js",
    instances: 1,
    exec_mode: "fork",
    // ... settingan bot lainnya biarkan sama ...
    kill_timeout: 10000, 
    env: { NODE_ENV: "development" }
  },
  {
      name: "suwayomi-server",
      // 👇 PERBAIKAN UTAMA DISINI 👇
      // Kita panggil CMD.exe secara eksplisit
      script: "C:\\Windows\\System32\\cmd.exe", 
      
      // Suruh CMD menjalankan file bat kamu
      args: "/c start_server.bat",
      
      // Lokasi folder
      cwd: "./suwayomi_server", 
      
      // Biar PM2 tidak bingung
      interpreter: "none" 
  }]
};