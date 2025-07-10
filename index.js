const express = require("express");
const app = express();
const PORT = 3000;
const { spawn } = require("child_process");

app.get("/", (req, res) => {
  const command = "ffmpeg --help";
  const child = spawn(command, []);
  child.stdout.on("data", (data) => {
    console.log(`stdout: ${data}`);
  });

  child.stderr.on("data", (data) => {
    console.error(`stderr: ${data}`);
  });

  child.on("close", (code) => {
    console.log(`child process exited with code ${code}`);
  });

  child.on("error", (err) => {
    console.error("Failed to start child process.", err);
  });
  res.send("Hello World");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
