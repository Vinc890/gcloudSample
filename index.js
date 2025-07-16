const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { Storage } = require("@google-cloud/storage");
const { TextToSpeechClient } = require("@google-cloud/text-to-speech");
const util = require("util");
const execPromise = util.promisify(require("child_process").exec);
const cors = require("cors");

const axios = require("axios");

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

app.post("/transcribe-audio", upload.single("audio"), async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res
      .status(401)
      .json({ error: "Missing or invalid Authorization header" });
  }

  if (!req.file) {
    return res.status(400).json({ error: "No audio file uploaded" });
  }

  try {
    const audioBytes = fs.readFileSync(req.file.path).toString("base64");

    // const requestBody = {
    //   config: {
    //     encoding: 'LINEAR16',
    //     sampleRateHertz: 16000,
    //     languageCode: 'en-US'
    //   },
    //   audio: {
    //     content: audioBytes
    //   }
    // };
    const requestBody = {
      config: {
        encoding: "WEBM_OPUS",
        sampleRateHertz: 48000,
        languageCode: "en-US",
      },
      audio: {
        content: audioBytes,
      },
    };
    const response = await axios.post(
      "https://speech.googleapis.com/v1/speech:recognize",
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    const transcription = response.data.results
      ?.map((result) => result.alternatives[0].transcript)
      .join("\n");

    res.json({ transcription: transcription || "No transcription found" });
  } catch (error) {
    console.error(
      "Speech-to-Text error:",
      error.response?.data || error.message
    );
    res.status(500).json({ error: "Failed to transcribe audio" });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

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
