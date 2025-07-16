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
const { TextToSpeechClient } = require("@google-cloud/text-to-speech");
const util = require("util");
const execPromise = util.promisify(require("child_process").exec);
const cors = require("cors");
const PORT = 3000;

const app = express();
app.use(express.json());
app.use(cors());

const upload = multer({ storage: multer.memoryStorage() });
const chunkUpload = multer({ storage: multer.memoryStorage() });

const TMP = "/tmp";
const SESSION_BUCKET = "zimulate";
const ROOT_FOLDER = "sessions";

const storage = new Storage();
const ttsClient = new TextToSpeechClient();


app.post("/uploadChunk", chunkUpload.single("chunk"), async (req, res) => {
  const { index, totalChunks, sessionId } = req.body;

  if (!index || !totalChunks || !sessionId || !req.file) {
    return res.status(400).send("Missing required fields or file.");
  }

  const chunkDir = path.join(TMP, ROOT_FOLDER, sessionId, "chunks");
  fs.mkdirSync(chunkDir, { recursive: true });

  const chunkPath = path.join(chunkDir, `chunk_${index}`);
  fs.writeFileSync(chunkPath, req.file.buffer);

  const receivedChunks = fs
    .readdirSync(chunkDir)
    .filter((f) => f.startsWith("chunk_")).length;
  console.log(
    `📥 Received chunk ${index}. Total received: ${receivedChunks}/${totalChunks}`
  );

  if (receivedChunks == parseInt(totalChunks)) {
    console.log("📦 All chunks received. Starting merge...");

    const chunkFiles = fs
      .readdirSync(chunkDir)
      .filter((f) => f.startsWith("chunk_"))
      .sort((a, b) => parseInt(a.split("_")[1]) - parseInt(b.split("_")[1]));

    const mergedPath = path.join(chunkDir, "merged.webm");
    const writeStream = fs.createWriteStream(mergedPath);

    for (const file of chunkFiles) {
      const buffer = fs.readFileSync(path.join(chunkDir, file));
      writeStream.write(buffer);
    }

    writeStream.end();

    writeStream.on("finish", async () => {
      const gcsPath = `${ROOT_FOLDER}/${sessionId}/Video/merged.webm`;
      await storage.bucket(SESSION_BUCKET).upload(mergedPath, {
        destination: gcsPath,
        contentType: "video/webm",
      });

      console.log(
        `✅ Merged video uploaded to gs://${SESSION_BUCKET}/${gcsPath}`
      );

      res.status(200).json({
        message: "Chunks uploaded and video merged.",
        videoUrl: `https://storage.googleapis.com/${SESSION_BUCKET}/${gcsPath}`,
      });
    });

    writeStream.on("error", (err) => {
      console.error("❌ Failed to merge chunks:", err);
      res.status(500).send("Failed to merge chunks.");
    });
  } else {
    res.status(200).send("Chunk received");
  }
});

app.post("/streamChunkUpload", upload.single("chunk"), async (req, res) => {
  const { index, sessionId, isFinal } = req.body;

  if (!index || !sessionId || !req.file) {
    return res.status(400).send("Missing required fields or file.");
  }

  const chunkDir = path.join(TMP, ROOT_FOLDER, sessionId, "chunks");
  fs.mkdirSync(chunkDir, { recursive: true });

  const chunkPath = path.join(chunkDir, `chunk_${index}`);
  fs.writeFileSync(chunkPath, req.file.buffer);

  console.log(`📥 Saved chunk ${index} for session ${sessionId}`);

  if (isFinal === "true") {
    console.log("✅ Final chunk received. Starting merge...");

    try {
      const chunkFiles = fs
        .readdirSync(chunkDir)
        .filter((f) => f.startsWith("chunk_"))
        .sort((a, b) => parseInt(a.split("_")[1]) - parseInt(b.split("_")[1]));

      const mergedPath = path.join(chunkDir, "merged.webm");
      const writeStream = fs.createWriteStream(mergedPath);

      for (const file of chunkFiles) {
        const buffer = fs.readFileSync(path.join(chunkDir, file));
        writeStream.write(buffer);
      }

      writeStream.end();

      writeStream.on("finish", async () => {
        const gcsPath = `${ROOT_FOLDER}/${sessionId}/Video/merged.webm`;
        await storage.bucket(SESSION_BUCKET).upload(mergedPath, {
          destination: gcsPath,
          contentType: "video/webm",
        });

        console.log(
          `🎥 Merged video uploaded to gs://${SESSION_BUCKET}/${gcsPath}`
        );

        return res.status(200).json({
          message: "Final chunk received. Video merged and uploaded.",
          videoUrl: `https://storage.googleapis.com/${SESSION_BUCKET}/${gcsPath}`,
        });
      });

      writeStream.on("error", (err) => {
        console.error("❌ Failed to merge chunks:", err);
        res.status(500).send("Failed to merge chunks.");
      });
    } catch (mergeErr) {
      console.error("❌ Merge error:", mergeErr);
      res.status(500).send("Internal server error during merge.");
    }
  } else {
    res.status(200).send("Chunk received");
  }
});

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
  res.json({
    audioPath: `gs://${SESSION_BUCKET}/${gcsPath}`,
    gcsUrl: `https://storage.googleapis.com/${SESSION_BUCKET}/${gcsPath}`,
    filename,
  });
});

app.post("/overlay", upload.none(), async (req, res) => {
  try {
    const { sessionId, baseTimestamp } = req.body;

    if (!sessionId || !baseTimestamp) {
      return res.status(400).send("Missing sessionId or baseTimestamp");
    }

    const sessionFolder = path.join(TMP, ROOT_FOLDER, sessionId);

    if (fs.existsSync(sessionFolder)) {
      fs.rmSync(sessionFolder, { recursive: true, force: true });
    }
    fs.mkdirSync(sessionFolder, { recursive: true });

    const videoGCSPath = `${ROOT_FOLDER}/${sessionId}/Video/merged.webm`;
    const localVideoPath = path.join(sessionFolder, "merged.webm");

    await storage.bucket(SESSION_BUCKET).file(videoGCSPath).download({
      destination: localVideoPath,
    });

    const [files] = await storage
      .bucket(SESSION_BUCKET)
      .getFiles({ prefix: `${ROOT_FOLDER}/${sessionId}/Audio/` });

    const audioFiles = [];

    for (const file of files) {
      const filename = path.basename(file.name);
      const match = filename.match(/^tts_\d+_(\d+)\.mp3$/);
      if (!match) continue;

      const timestamp = parseInt(match[1]);
      const delay = Math.max(0, timestamp - parseInt(baseTimestamp)); // in ms
      const localPath = path.join(sessionFolder, filename);

      await file.download({ destination: localPath });
      audioFiles.push({ path: localPath, delay });
    }

    if (audioFiles.length === 0) {
      return res.status(400).send("No valid TTS audio files found.");
    }

    const ffmpegInputs = [`-i "${localVideoPath}"`];
    const filterParts = [];
    const mixInputs = [];

    mixInputs.push(`[0:a]`);

    audioFiles.forEach((file, i) => {
      ffmpegInputs.push(`-i "${file.path}"`);
      const label = `a${i}`;
      filterParts.push(
        `[${i + 1}:a]adelay=${file.delay}|${file.delay}[${label}]`
      );
      mixInputs.push(`[${label}]`);
    });

    filterParts.push(
      `${mixInputs.join("")}amix=inputs=${mixInputs.length}[aout]`
    );

    const finalOutputName = `final_${Date.now()}.webm`;
    const finalOutputPath = path.join(sessionFolder, finalOutputName);

    const ffmpegCommand = [
      ...ffmpegInputs,
      `-filter_complex "${filterParts.join(";")}"`,
      `-map 0:v -map "[aout]" -c:v copy -c:a libopus -shortest `,
      `"${finalOutputPath}"`,
    ].join(" ");

    console.log("🎬 Executing ffmpeg overlay...");
    await execPromise(`/usr/bin/ffmpeg ${ffmpegCommand}`);

    // const finalGCSPath = `${ROOT_FOLDER}/${sessionId}/Final/${finalOutputName}`;
    // await storage.bucket(SESSION_BUCKET).upload(finalOutputPath, {
    //   destination: finalGCSPath,
    //   contentType: "video/webm",
    // });

    const finalGCSPath = `${ROOT_FOLDER}/${sessionId}/${finalOutputName}`;
    await storage.bucket(SESSION_BUCKET).upload(finalOutputPath, {
      destination: finalGCSPath,
      contentType: "video/webm",
    });

    console.log(`✅ Final video uploaded to ${finalGCSPath}`);
    //temop
    await Promise.all([
      storage.bucket(SESSION_BUCKET).deleteFiles({
        prefix: `${ROOT_FOLDER}/${sessionId}/Audio/`,
      }),
      storage.bucket(SESSION_BUCKET).deleteFiles({
        prefix: `${ROOT_FOLDER}/${sessionId}/Video/`,
      }),
    ]);
    //here
    // res.json({
    //   message: "Overlay complete",
    //   videoUrl: `https://storage.googleapis.com/${SESSION_BUCKET}/${finalGCSPath}`,
    // });
    res.json({
      message: "Overlay complete",
      videoUrl: `https://storage.googleapis.com/${SESSION_BUCKET}/${finalGCSPath}`,
    });
  } catch (err) {
    console.error("❌ Overlay error:", err);
    res.status(500).send("Failed to overlay audio.");
  }
});

app.post("/overlay2", upload.none(), async (req, res) => {
  try {
    const {
      sessionId,
      baseTimestamp,
      email,
      firstName,
      lastName,
      testName,
      attemptNo,
    } = req.body;

    if (!sessionId || !baseTimestamp) {
      return res.status(400).send("Missing sessionId or baseTimestamp");
    }

    const sessionFolder = path.join(TMP, ROOT_FOLDER, sessionId);
    fs.rmSync(sessionFolder, { recursive: true, force: true });
    fs.mkdirSync(sessionFolder, { recursive: true });

    const videoGCSPath = `${ROOT_FOLDER}/${sessionId}/Video/merged.webm`;
    const localVideoPath = path.join(sessionFolder, "merged.webm");

    await storage.bucket(SESSION_BUCKET).file(videoGCSPath).download({
      destination: localVideoPath,
    });

    const [files] = await storage
      .bucket(SESSION_BUCKET)
      .getFiles({ prefix: `${ROOT_FOLDER}/${sessionId}/Audio/` });

    const audioFiles = [];
    for (const file of files) {
      const filename = path.basename(file.name);
      const match = filename.match(/^tts_\d+_(\d+)\.mp3$/);
      if (!match) continue;

      const timestamp = parseInt(match[1]);
      const delay = Math.max(0, timestamp - parseInt(baseTimestamp));
      const localPath = path.join(sessionFolder, filename);

      await file.download({ destination: localPath });
      audioFiles.push({ path: localPath, delay });
    }

    if (audioFiles.length === 0) {
      return res.status(400).send("No valid TTS audio files found.");
    }

    const ffmpegInputs = [`-i "${localVideoPath}"`];
    const filterParts = [];
    const mixInputs = [`[0:a]`];

    audioFiles.forEach((file, i) => {
      ffmpegInputs.push(`-i "${file.path}"`);
      const label = `a${i}`;
      filterParts.push(
        `[${i + 1}:a]adelay=${file.delay}|${file.delay}[${label}]`
      );
      mixInputs.push(`[${label}]`);
    });

    filterParts.push(
      `${mixInputs.join("")}amix=inputs=${mixInputs.length}[aout]`
    );

    const finalOutputName = `final_${Date.now()}.webm`;
    const finalOutputPath = path.join(sessionFolder, finalOutputName);

    const ffmpegCommand = [
      ...ffmpegInputs,
      `-filter_complex "${filterParts.join(";")}"`,
      `-map 0:v -map "[aout]" -c:v copy -c:a libopus -shortest`,
      `"${finalOutputPath}"`,
    ].join(" ");

    console.log("🎬 Executing ffmpeg overlay...");
    await execPromise(`/usr/bin/ffmpeg ${ffmpegCommand}`);

    const finalGCSPath = `${ROOT_FOLDER}/${sessionId}/${finalOutputName}`;
    await storage.bucket(SESSION_BUCKET).upload(finalOutputPath, {
      destination: finalGCSPath,
      contentType: "video/webm",
    });

    console.log(`✅ Final video uploaded to ${finalGCSPath}`);

    const params = new URLSearchParams({
      email,
      firstName,
      lastName,
      testName,
      attempt: attemptNo,
      companyId: "LTI",
      videoPath: finalOutputPath,
    });

    try {
      const submitResponse = await fetch(
        `https://myac.ai:99/submit-video?${params.toString()}`,
        { method: "POST" }
      );
      const result = await submitResponse.json();
      console.log("📤 Submission result:", result);
    } catch (submitError) {
      console.error("❌ Submission failed:", submitError);
      res.status(500).send("Submission failed.");
    }

    await Promise.all([
      storage.bucket(SESSION_BUCKET).deleteFiles({
        prefix: `${ROOT_FOLDER}/${sessionId}/Audio/`,
      }),
      storage.bucket(SESSION_BUCKET).deleteFiles({
        prefix: `${ROOT_FOLDER}/${sessionId}/Video/`,
      }),
    ]);

    fs.rmSync(sessionFolder, { recursive: true, force: true });

    res.json({
      message: "Overlay complete and video submitted.",
      videoUrl: `https://storage.googleapis.com/${SESSION_BUCKET}/${finalGCSPath}`,
    });
  } catch (err) {
    console.error("❌ Overlay error:", err);
    res.status(500).send("Failed to overlay and submit video.");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
