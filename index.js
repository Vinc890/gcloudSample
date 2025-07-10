const express = require("express");
const app = express();
const PORT = 3000;
const { exec } = require('child_process');

app.get("/", (req, res) => {


exec('ffmpeg --help', (err, stdout, stderr) => {
  if (err) {
    console.error('FFmpeg not found:', stderr);
  } else {
    console.log('FFmpeg path:', stdout.trim());
  }
});

  res.send("Hello World 1");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
