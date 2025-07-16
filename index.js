// const express = require("express");
require("dotenv").config();
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { Storage } = require("@google-cloud/storage");
const { TextToSpeechClient } = require("@google-cloud/text-to-speech");
const util = require("util");
const execPromise = util.promisify(require("child_process").exec);
const cors = require("cors");

const axios = require("axios");
const { GoogleAuth } = require("google-auth-library");

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

async function getAccessToken() {
  const auth = new GoogleAuth({
    keyFile: {
      type: "service_account",
      project_id: "contactaiassessments",
      private_key_id: "238a6770ff60a2556e9aa80e4bf25049f7d00a01",
      private_key:
        "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCb1dSmL7txWvqW\n5C1rkrw2dqaGciTLdgj4YjJbzC0ZSU0UpbbqXkx51SyXKhiArB4H6TfK3sImDJqL\n/kZl8MvWlWCegoXOeiXtwhLxsD6xOCMwcIbSaeggCKH9q3M8MjR0+4G6w6pKykkU\nXLeToLjNzQOGe5rf9Igz4Z5CEcz8Ju+ZUgiSrVYbJTz0eDjvo57Dtfu6ro/AYS/5\nXnFKRts+4VerM3RCZsFRLhP7pjbL0ywYUW3Tl1k6RyOvA9cxoLXVGoX3Dz7nTCtF\nyYG4iKZ1wJLO6xngspFYGKYKWpnu8A8y3jPeSzP6INdPKkmSdYPaiZUhpbgy8mIb\nMjlbt9ZpAgMBAAECggEADquDEL/2k9W+OF0zn2hZWoEx7P8q0pKChqtr1TNz3WkG\nnhZ5kTeeWGvGflaCpv5M926vh2QP/9f45ovh4a/Y6JL4XQOpiAX8sxStht4SEMnZ\nmjJFpuI8bWOSqFgvCXAqewbAMC5CRjcjyQxvZbDgJNOTbOIO8t1IwyWOqeaWFviH\nqKRjb+H63TQ/tj4OX2DxElCa9js166/FOrBPR7Fk4GS2CG0w+d2Lhk1FFf+v42QE\nLLbxtUTKZg68HkrUQ983qzMi0t8ddH6Jf459HGCof8PmZr1SVFjRWbyiaLKyTu7p\n1apyJpchmMuE4w0ypl7WWucAto3yQZ9kycbW/TD1nwKBgQDXRZb5S4QeWGZmKe6+\nZJl6h/6ijGYNgqjnHLoeMdF9TS5Qxjhvlp8ucpi6eotFEvRcR5QigtSLIX+lUKMj\nc2UyQVcY2bFfys5dJeFad5trg9WIeBvpa6BvyjqYu1F8OuNSpaOXZ6Nk+vSC3rLX\n/sQv0qZvwOfUmMOoXbF7aBWntwKBgQC5UYJAIF39DyceOWYpgdXm73Erde/ezHk8\nv0hvugKHOByc1DUdUP0lyXNULo+8K5tBkBYN1SYoFXRE6yEMGOC48Ud7OPaJa7Rk\nNMdy4f85JKY3BdgrgzGOD1SoZrQtN4QFnr+rthFsyFAMjBkuP9U7ehX+HyyFaDI8\nS6MGsK8y3wKBgQDB948oQzXhTc++YCwhW227LUxv1EekBsX/sC+3QzY6S8/esixp\nx3LYnCMna4GPlJufhlNgoTe3wVBNeZH1QGW/WYaL+qLK6Gb3IUmjhUACKUC+/VJR\nCUv/Tl1r/uRWJo1ri5oSsyxTsZedT+IfowvM92ZGLa/2LEunqfxgcJGKkwKBgD1V\nJqCGldS9ARtVr+Qo3lxR/sh9feflEHL0c8rWayPJhF67NOEA/udUpuDDkDqczAOE\n5meplblKcHKmxwcz7JwI7rlvfti4VrmbZi81cLy+zmwDeSndf7ceh8w8QYF9kCo0\nAgeYeGfiW+vrKiJOagoHO+Qg+SEl/QpLlicOrs1NAoGAXjx5voRw2AiuGY2tohtM\nIG0O6ohFhHUFDyg0UZS1o4OMfpA0vMx/SXhLG09fnXGtAHD6cLqoHVUkTOxjNzDY\nLLLjL35+y0ixtqRXR9Rndh0hGaDroy0PT8r0piLmKHv2TxRkHMZSiUMvHOpoUibT\nyCEd9D9ogCvkpvghVSZataM=\n-----END PRIVATE KEY-----\n",
      client_email:
        "service-account-test@contactaiassessments.iam.gserviceaccount.com",
      client_id: "113213039598146082674",
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url:
        "https://www.googleapis.com/robot/v1/metadata/x509/service-account-test%40contactaiassessments.iam.gserviceaccount.com",
      universe_domain: "googleapis.com",
    },
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  return await client.getAccessToken();
}

app.post("/transcribe", async (req, res) => {
  const { audioContent } = req.body;

  if (!audioContent) {
    return res
      .status(400)
      .json({ error: "Missing audioContent in base64 format" });
  }

  try {
    const token = await getAccessToken();

    const payload = {
      config: {
        encoding: "LINEAR16",
        sampleRateHertz: 16000,
        languageCode: "en-US",
      },
      audio: {
        content: audioContent,
      },
    };

    const { data } = await axios.post(
      "https://speech.googleapis.com/v1/speech:recognize",
      payload,
      {
        headers: {
          Authorization: `Bearer ${token.token}`,
          "Content-Type": "application/json",
        },
      }
    );

    const transcript =
      data.results?.map((r) => r.alternatives[0].transcript).join(" ") || "";
    res.json({ transcript });
  } catch (err) {
    const message = err.response?.data || err.message;
    res.status(500).json({ error: message });
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
