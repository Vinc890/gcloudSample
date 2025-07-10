const express = require("express");
const app = express();
const PORT = 3000;
const { exec } = require('child_process');

app.get("/", (req, res) => {

const ffmpeg = spawn('/usr/bin/ffmpeg', ['--help']);

  ffmpeg.stdout.on('data', (data) => {
    console.log(`stdout: ${data}`);
  });

  ffmpeg.stderr.on('data', (data) => {
    console.error(`stderr: ${data}`);
  });

  ffmpeg.on('close', (code) => {
    console.log(`FFmpeg exited with code ${code}`);
    callback(code === 0 ? null : new Error('Conversion failed'));
  });

  res.send("Hello World");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
