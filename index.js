// require("dotenv").config();
// const express = require("express");
// const app = express();
// const PORT = 3000;
// const { spawn } = require("child_process");
// const path = require("path");
// const fs = require("fs");
// const { Storage } = require("@google-cloud/storage");
// const { exec } = require("child_process");
// const util = require("util");
// const execPromise = util.promisify(exec);
// const multer = require("multer");
// const upload = multer({ dest: "tmp/" });

// const storage = new Storage();

// app.get("/", (req, res) => {
//   const ffmpeg = spawn("/usr/bin/ffmpeg", ["--help"]);

//   ffmpeg.stdout.on("data", (data) => {
//     console.log(`stdout: ${data}`);
//   });

//   ffmpeg.stderr.on("data", (data) => {
//     console.error(`stderr: ${data}`);
//   });

//   ffmpeg.on("close", (code) => {
//     console.log(`FFmpeg exited with code ${code}`);
//     callback(code === 0 ? null : new Error("Conversion failed"));
//   });

//   res.send("Hello World");
// });

// app.post("/overlay-audio", async (req, res) => {
//   try {
//     const bucketName = "zimulate";
//     const folder = "GoogleFunctions";
//     const videoFileName = "v1.webm";
//     const audioFiles = [
//       { name: "tt1.mp3", delay: 20 },
//       { name: "tt2.mp3", delay: 30 },
//       { name: "tt3.mp3", delay: 30 },
//     ];

//     const localDir = path.join(__dirname, "tmp");
//     if (!fs.existsSync(localDir)) fs.mkdirSync(localDir);

//     const downloadFile = async (fileName) => {
//       const localPath = path.join(localDir, fileName);
//       const file = storage.bucket(bucketName).file(`${folder}/${fileName}`);
//       await file.download({ destination: localPath });
//       return localPath;
//     };

//     // Download video and audio files
//     const videoPath = await downloadFile(videoFileName);
//     const audioPaths = await Promise.all(
//       audioFiles.map((f) => downloadFile(f.name))
//     );

//     // Construct ffmpeg input arguments
//     const ffmpegInputs = [`-i "${videoPath}"`];
//     const filterParts = [];
//     const mixInputs = [];

//     audioPaths.forEach((audioPath, index) => {
//       ffmpegInputs.push(`-i "${audioPath}"`);
//       const delay = audioFiles[index].delay * 1000;
//       const label = `a${index}`;
//       filterParts.push(`[${index + 1}:a]adelay=${delay}|${delay}[${label}]`);
//       mixInputs.push(`[${label}]`);
//     });

//     filterParts.push(
//       `${mixInputs.join("")}amix=inputs=${audioPaths.length}[mixed]`
//     );
//     filterParts.push(`[0:a][mixed]amix=inputs=2[aout]`);

//     const outputFileName = `output_${Date.now()}.webm`;
//     const outputPath = path.join(localDir, outputFileName);

//     const ffmpegCommand = [
//       ...ffmpegInputs,
//       `-filter_complex "${filterParts.join(";")}"`,
//       `-map 0:v -map "[aout]" -c:v copy -c:a libvorbis `,
//       `"${outputPath}"`,
//     ].join(" ");

//     console.log(" Running ffmpeg...");

//     await execPromise(`/usr/bin/ffmpeg ${ffmpegCommand}`);

//     const destinationPath = `${folder}/${outputFileName}`;
//     await storage.bucket(bucketName).upload(outputPath, {
//       destination: destinationPath,
//       contentType: "video/mp4",
//     });

//     console.log(`✅ Uploaded to GCS: ${destinationPath}`);
//     res.json({ outputUrl: `gs://${bucketName}/${destinationPath}` });

//     // Cleanup
//     [videoPath, ...audioPaths, outputPath].forEach((filePath) => {
//       fs.unlinkSync(filePath);
//     });
//   } catch (err) {
//     console.error("❌ Error in /overlay-audio:", err);
//     res.status(500).send(`Overlay failed.${err}`);
//   }
// });

// app.listen(PORT, () => {
//   console.log(`Server is running on http://localhost:${PORT}`);
// });

// server.js
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { Storage } = require('@google-cloud/storage');
const tmp = require('tmp');
const axios = require('axios');
const { promisify } = require('util');
const { exec } = require('child_process');
const execAsync = promisify(exec);

const app = express();
const PORT = 3000;

app.use(express.json());
const upload = multer({ dest: 'temp_chunks/' });

const sessions = {};
const bucketName = 'zimulate';
const folderName = 'GoogleFunctions';
const audioFiles = [
  { name: 'tt1.mp3', delay: 20 },
  { name: 'tt2.mp3', delay: 30 },
  { name: 'tt3.mp3', delay: 30 },
];

const storage = new Storage();

app.post('/record', async (req, res) => {
  const { start, stop, sessionId, startTimestamp } = req.body;

  if (start) {
    sessions[sessionId] = {
      startTimestamp,
      chunks: [],
    };
    fs.mkdirSync(`recordings/${sessionId}`, { recursive: true });
    return res.sendStatus(200);
  }

  if (stop) {
    const session = sessions[sessionId];
    if (!session) return res.status(404).send('Session not found');

    const outputFileName = `${session.startTimestamp}.webm`;
    const outputPath = `final_videos/${outputFileName}`;

    mergeChunks(sessionId, outputPath)
      .then(() => uploadToBucket(outputPath, outputFileName))
      .then(() => overlayAudio(outputPath, session.startTimestamp))
      .then(() => res.sendStatus(200))
      .catch(err => {
        console.error(err);
        res.sendStatus(500);
      });

    return;
  }

  res.sendStatus(400);
});

app.post('/upload', upload.single('videoChunk'), (req, res) => {
  const { sessionId } = req.body;
  const session = sessions[sessionId];
  if (!session) return res.status(404).send('Session not found');

  const chunkPath = `recordings/${sessionId}/${Date.now()}-${req.file.originalname}`;
  fs.renameSync(req.file.path, chunkPath);
  session.chunks.push(chunkPath);

  res.sendStatus(200);
});

function mergeChunks(sessionId, outputPath) {
  return new Promise((resolve, reject) => {
    const session = sessions[sessionId];
    const files = session.chunks;

    const mergedList = `recordings/${sessionId}/input.txt`;
    const fileContent = files.map(f => `file '${path.resolve(f)}'`).join('\n');
    fs.writeFileSync(mergedList, fileContent);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    ffmpeg()
      .input(mergedList)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .on('end', () => resolve())
      .on('error', reject)
      .save(outputPath);
  });
}

async function uploadToBucket(localPath, destFileName) {
  const destination = `${folderName}/${destFileName}`;
  await storage.bucket(bucketName).upload(localPath, {
    destination,
    gzip: true,
    metadata: { cacheControl: 'no-cache' },
  });
  console.log(`Uploaded ${destFileName} to ${bucketName}/${folderName}`);
}

async function overlayAudio(videoPath, startTimestamp) {
  const tmpDir = tmp.dirSync().name;
  const inputs = [];
  const filters = [];
  let filterCount = 0;

  for (let i = 0; i < audioFiles.length; i++) {
    const { name, delay } = audioFiles[i];
    const gcsPath = `https://storage.googleapis.com/${bucketName}/${folderName}/${name}`;
    const localPath = path.join(tmpDir, name);

    const response = await axios.get(gcsPath, { responseType: 'stream' });
    const writer = fs.createWriteStream(localPath);
    await new Promise((resolve, reject) => {
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    inputs.push(`-i "${localPath}"`);
    filters.push(`[${filterCount + 1}:a]adelay=${delay * 1000}|${delay * 1000}[a${i}]`);
    filterCount++;
  }

  const filterComplex = [
    ...filters,
    `amix=inputs=${audioFiles.length + 1}:duration=shortest:dropout_transition=0[aout]`,
  ].join('; ');

  const outputPath = videoPath.replace('.webm', '_final.mp4');
  const cmd = `ffmpeg -y -i "${videoPath}" ${inputs.join(' ')} -filter_complex "${filterComplex}" -map 0:v -map "[aout]" -c:v copy -shortest "${outputPath}"`;

  try {
    console.log("Running ffmpeg overlay command...");
    await execAsync(cmd);
    await uploadToBucket(outputPath, `${startTimestamp}_final.mp4`);
    console.log("Final video uploaded with overlayed audio.");
  } catch (err) {
    console.error("Error overlaying audio:", err);
    throw err;
  }
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

