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
//     const videoFileName = "vv1.webm";
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

// const upload = multer({ storage: multer.memoryStorage() });

// app.post("/uploadChunks", upload.any(), async (req, res) => {
//   try {
//     const files = req.files;
//     if (!files || files.length === 0) {
//       return res.status(400).send("No chunks received");
//     }

//     const sortedChunks = files
//       .filter(f => f.fieldname.startsWith("chunk-"))
//       .sort((a, b) => {
//         const aIndex = parseInt(a.fieldname.split("-")[1]);
//         const bIndex = parseInt(b.fieldname.split("-")[1]);
//         return aIndex - bIndex;
//       });

//     const localDir = path.join(__dirname, "tmp");
//     if (!fs.existsSync(localDir)) fs.mkdirSync(localDir);

//     const outputPath = path.join(localDir, "vv1.webm");
//     const writeStream = fs.createWriteStream(outputPath);

//     for (const chunk of sortedChunks) {
//       writeStream.write(chunk.buffer);
//     }

//     writeStream.end();

//     writeStream.on("finish", async () => {
//       try {
//         const bucketName = "zimulate";
//         const folder = "GoogleFunctions";
//         const destinationPath = `${folder}/vv1.webm`;

//         await storage.bucket(bucketName).upload(outputPath, {
//           destination: destinationPath,
//           contentType: "video/webm",
//         });

//         fs.unlinkSync(outputPath);

//         console.log(`✅ Uploaded vv1.webm to GCS`);
//         res.status(200).json({ message: "Upload complete", path: destinationPath });
//       } catch (err) {
//         console.error("❌ GCS Upload failed:", err);
//         res.status(500).send("Upload to GCS failed");
//       }
//     });

//     writeStream.on("error", (err) => {
//       console.error("❌ File write error:", err);
//       res.status(500).send("Failed to write video");
//     });
//   } catch (err) {
//     console.error("❌ Error in /uploadChunks:", err);
//     res.status(500).send("Unexpected server error");
//   }
// });

// app.post("/upload-and-overlay", upload.any(), async (req, res) => {
//   try {
//     const files = req.files;
//     if (!files || files.length === 0) {
//       return res.status(400).send("No chunks received");
//     }

//     // Sort and reassemble chunks
//     const sortedChunks = files
//       .filter(f => f.fieldname.startsWith("chunk-"))
//       .sort((a, b) => {
//         const aIndex = parseInt(a.fieldname.split("-")[1]);
//         const bIndex = parseInt(b.fieldname.split("-")[1]);
//         return aIndex - bIndex;
//       });

//     const localDir = path.join(__dirname, "tmp");
//     if (!fs.existsSync(localDir)) fs.mkdirSync(localDir);

//     const tempInputPath = path.join(localDir, "vv1.webm");
//     const writeStream = fs.createWriteStream(tempInputPath);

//     for (const chunk of sortedChunks) {
//       writeStream.write(chunk.buffer);
//     }
//     writeStream.end();

//     writeStream.on("finish", async () => {
//       try {
//         const bucketName = "zimulate";
//         const folder = "GoogleFunctions";
//         const inputFileName = "vv1.webm";
//         const inputGCSPath = `${folder}/${inputFileName}`;

//         // Upload raw video to GCS
//         await storage.bucket(bucketName).upload(tempInputPath, {
//           destination: inputGCSPath,
//           contentType: "video/webm",
//         });

//         console.log(`✅ Uploaded ${inputFileName} to GCS`);

//         // Now: overlay audio on the uploaded video
//         const audioFiles = [
//           { name: "tt1.mp3", delay: 20 },
//           { name: "tt2.mp3", delay: 30 },
//           { name: "tt3.mp3", delay: 30 },
//         ];

//         const downloadFile = async (fileName) => {
//           const localPath = path.join(localDir, fileName);
//           const file = storage.bucket(bucketName).file(`${folder}/${fileName}`);
//           await file.download({ destination: localPath });
//           return localPath;
//         };

//         const videoPath = await downloadFile(inputFileName);
//         const audioPaths = await Promise.all(
//           audioFiles.map((f) => downloadFile(f.name))
//         );

//         // FFMPEG setup
//         const ffmpegInputs = [`-i "${videoPath}"`];
//         const filterParts = [];
//         const mixInputs = [];

//         audioPaths.forEach((audioPath, index) => {
//           ffmpegInputs.push(`-i "${audioPath}"`);
//           const delay = audioFiles[index].delay * 1000;
//           const label = `a${index}`;
//           filterParts.push(`[${index + 1}:a]adelay=${delay}|${delay}[${label}]`);
//           mixInputs.push(`[${label}]`);
//         });

//         filterParts.push(`${mixInputs.join("")}amix=inputs=${audioPaths.length}[mixed]`);
//         filterParts.push(`[0:a][mixed]amix=inputs=2[aout]`);

//         const outputFileName = `output_${Date.now()}.webm`;
//         const outputPath = path.join(localDir, outputFileName);

//         const ffmpegCommand = [
//           ...ffmpegInputs,
//           `-filter_complex "${filterParts.join(";")}"`,
//           `-map 0:v -map "[aout]" -c:v copy -c:a libvorbis `,
//           `"${outputPath}"`,
//         ].join(" ");

//         console.log("▶️ Running ffmpeg...");
//         await execPromise(`/usr/bin/ffmpeg ${ffmpegCommand}`);

//         const outputGCSPath = `${folder}/${outputFileName}`;
//         await storage.bucket(bucketName).upload(outputPath, {
//           destination: outputGCSPath,
//           contentType: "video/webm",
//         });

//         console.log(`✅ Final video uploaded: ${outputGCSPath}`);

//         // Cleanup
//         [tempInputPath, videoPath, ...audioPaths, outputPath].forEach((filePath) => {
//           if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
//         });

//         res.status(200).json({
//           message: "Upload and overlay complete",
//           videoUrl: `gs://${bucketName}/${outputGCSPath}`,
//         });

//       } catch (err) {
//         console.error("❌ Processing failed:", err);
//         res.status(500).send("Audio overlay or GCS upload failed.");
//       }
//     });

//     writeStream.on("error", (err) => {
//       console.error("❌ Chunk file write error:", err);
//       res.status(500).send("Failed to write video file.");
//     });

//   } catch (err) {
//     console.error("❌ Unexpected error in /upload-and-overlay:", err);
//     res.status(500).send("Server error");
//   }
// });

// app.listen(PORT, () => {
//   console.log(`Server is running on http://localhost:${PORT}`);
// });











// -------------------------------------------------------------------------------------------------------











// require("dotenv").config();
// const express = require("express");
// const app = express();
// const PORT = 3000;
// const path = require("path");
// const fs = require("fs");
// const { Storage } = require("@google-cloud/storage");
// const { exec } = require("child_process");
// const util = require("util");
// const multer = require("multer");
// const cors = require("cors");

// const execPromise = util.promisify(exec);
// const storage = new Storage();

// app.use(cors());
// app.use(express.json());

// const chunkUpload = multer({ storage: multer.memoryStorage() });

// app.post("/uploadChunk", chunkUpload.single("chunk"), (req, res) => {
//   const { index, videoId } = req.body;
//   const chunkDir = path.join(__dirname, "tmp/chunks", videoId);
//   if (!fs.existsSync(chunkDir)) fs.mkdirSync(chunkDir, { recursive: true });

//   const chunkPath = path.join(chunkDir, `chunk_${index}`);
//   fs.writeFileSync(chunkPath, req.file.buffer);
//   res.status(200).send("Chunk saved");
// });

// app.post("/finalizeUpload", async (req, res) => {
//   const { videoId, audioOverlays } = req.body;

//   const localDir = path.join(__dirname, "tmp");
//   const chunkDir = path.join(localDir, "chunks", videoId);
//   const assembledPath = path.join(localDir, "vv1.webm");

//   try {
//     const chunkFiles = fs.readdirSync(chunkDir).sort((a, b) => {
//       const aIndex = parseInt(a.split("_")[1]);
//       const bIndex = parseInt(b.split("_")[1]);
//       return aIndex - bIndex;
//     });

//     const writeStream = fs.createWriteStream(assembledPath);
//     for (const chunkFile of chunkFiles) {
//       const data = fs.readFileSync(path.join(chunkDir, chunkFile));
//       writeStream.write(data);
//     }
//     writeStream.end();

//     await new Promise((resolve, reject) => {
//       writeStream.on("finish", resolve);
//       writeStream.on("error", reject);
//     });

//     const bucketName = "zimulate";
//     const folder = "GoogleFunctions";
//     const videoDest = `${folder}/vv1.webm`;

//     await storage.bucket(bucketName).upload(assembledPath, {
//       destination: videoDest,
//       contentType: "video/webm",
//     });

//     console.log("✅ Uploaded vv1.webm to GCS");

//     const downloadFile = async (fileName) => {
//       const localPath = path.join(localDir, fileName);
//       const file = storage.bucket(bucketName).file(`${folder}/${fileName}`);
//       await file.download({ destination: localPath });
//       return localPath;
//     };

//     const videoPath = assembledPath;
//     const audioPaths = await Promise.all(
//       audioOverlays.map((f) => downloadFile(f.file))
//     );

//     const ffmpegInputs = [`-i "${videoPath}"`];
//     const filterParts = [];
//     const mixInputs = [];

//     audioPaths.forEach((audioPath, index) => {
//       ffmpegInputs.push(`-i "${audioPath}"`);
//       const delay = audioOverlays[index].start * 1000;
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
//       `-map 0:v -map "[aout]" -c:v copy -c:a libvorbis`,
//       `"${outputPath}"`,
//     ].join(" ");

//     console.log("Running ffmpeg...");
//     await execPromise(`/usr/bin/ffmpeg ${ffmpegCommand}`);

//     const outputDest = `${folder}/${outputFileName}`;
//     await storage.bucket(bucketName).upload(outputPath, {
//       destination: outputDest,
//       contentType: "video/webm",
//     });

//     console.log(`✅ Final output uploaded to ${outputDest}`);
//     res.json({
//       message: "Overlay complete",
//       outputUrl: `gs://${bucketName}/${outputDest}`,
//     });

//     fs.unlinkSync(outputPath);
//     fs.unlinkSync(assembledPath);
//     fs.rmSync(chunkDir, { recursive: true });
//     audioPaths.forEach((p) => fs.unlinkSync(p));
//   } catch (err) {
//     console.error("❌ Finalize failed:", err);
//     res.status(500).send("Failed to process video");
//   }
// });

// app.listen(PORT, () => {
//   console.log(`🚀 Server is running on http://localhost:${PORT}`);
// });












// -------------------------------------------------------------------------------------------------------












const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { Storage } = require("@google-cloud/storage");
const util = require("util");
const execPromise = util.promisify(require("child_process").exec);
const cors = require("cors");
const { TextToSpeechClient } = require("@google-cloud/text-to-speech");

const app = express();
app.use(express.json());
app.use(cors());

const storage = new Storage();
const ttsClient = new TextToSpeechClient();
const upload = multer({ storage: multer.memoryStorage() });

const TMP = "/tmp"; 
const SESSION_BUCKET = "zimulate"; 
const ROOT_FOLDER = "sessions";

app.post("/tts", upload.none(), async (req, res) => {
  const { sessionId, startTimestamp, text } = req.body;
  if (!sessionId || !startTimestamp || !text) {
    return res.status(400).send("Missing sessionId, startTimestamp, or text");
  }
  const sessionFolder = `${ROOT_FOLDER}/${sessionId}`;
  const filename = `tts_${startTimestamp}_${Date.now()}.mp3`;
  const localPath = path.join(TMP, filename);

  const [response] = await ttsClient.synthesizeSpeech({
    input: { text },
    voice: { languageCode: "en-US", name: "en-US-Wavenet-D" },
    audioConfig: { audioEncoding: "MP3" },
  });
  fs.writeFileSync(localPath, response.audioContent, "binary");

  const gcsPath = `${sessionFolder}/Audio/${filename}`;
  await storage.bucket(SESSION_BUCKET).upload(localPath, {
    destination: gcsPath,
    contentType: "audio/mp3",
  });
  fs.unlinkSync(localPath);
  res.json({ audioPath: `gs://${SESSION_BUCKET}/${gcsPath}`, filename });
});

app.post("/upload-and-overlay", upload.array("chunks"), async (req, res) => {
  const { sessionId, startTimestamp } = req.body;
  if (!sessionId || !startTimestamp) {
    return res.status(400).send("Missing sessionId or startTimestamp");
  }
  const sessionFolder = `${ROOT_FOLDER}/${sessionId}`;
  const rawVideoName = `video_${startTimestamp}.webm`;
  const audioFolder = path.join(TMP, "audio");
  const videoTmpPath = path.join(TMP, rawVideoName);

  fs.writeFileSync(videoTmpPath, Buffer.concat(req.files.map(f => f.buffer)));

  const rawGcsPath = `${sessionFolder}/Video/${rawVideoName}`;
  await storage.bucket(SESSION_BUCKET).upload(videoTmpPath, {
    destination: rawGcsPath,
    contentType: "video/webm",
  });

  const [files] = await storage
    .bucket(SESSION_BUCKET)
    .getFiles({ prefix: `${sessionFolder}/Audio/` });
  const audioFiles = [];
  for (let file of files) {
    const filename = path.basename(file.name);
    const match = filename.match(/^tts_(\d+)_.*\.mp3$/);
    if (!match) continue;
    const timestamp = parseInt(match[1]) - parseInt(startTimestamp);
    const local = path.join(TMP, filename);
    await file.download({ destination: local });
    audioFiles.push({ local, delay: timestamp });
  }

  const inputArgs = [`-i "${videoTmpPath}"`];
  const filterParts = [];
  const mixLabels = [];
  audioFiles.forEach((a, i) => {
    inputArgs.push(`-i "${a.local}"`);
    filterParts.push(`[${i + 1}:a]adelay=${a.delay}|${a.delay}[a${i}]`);
    mixLabels.push(`[a${i}]`);
  });
  filterParts.push(`${mixLabels.join("")}amix=inputs=${audioFiles.length}[mixed]`);
  filterParts.push(`[0:a][mixed]amix=inputs=2[aout]`);

  const outputName = `final_${Date.now()}.webm`;
  const outPath = path.join(TMP, outputName);
  const cmd = [
    ...inputArgs,
    `-filter_complex "${filterParts.join(";")}"`,
    `-map 0:v -map "[aout]" -c:v copy -c:a libvorbis`,
    `"${outPath}"`,
  ].join(" ");

  await execPromise(`/usr/bin/ffmpeg ${cmd}`);

  const finalGcs = `${sessionFolder}/Final/${outputName}`;
  await storage.bucket(SESSION_BUCKET).upload(outPath, {
    destination: finalGcs,
    contentType: "video/webm",
  });

  fs.unlinkSync(videoTmpPath);
  fs.unlinkSync(outPath);
  audioFiles.forEach(a => fs.unlinkSync(a.local));

  res.json({ finalVideoPath: `gs://${SESSION_BUCKET}/${finalGcs}` });
});

module.exports = app;
