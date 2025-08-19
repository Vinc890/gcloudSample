require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { Storage } = require("@google-cloud/storage");
const { TextToSpeechClient } = require("@google-cloud/text-to-speech");
const util = require("util");
const execPromise = util.promisify(require("child_process").exec);
const cors = require("cors");
const speech = require("@google-cloud/speech");
const { google } = require("googleapis");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const ffmpeg = require("fluent-ffmpeg");

const PORT = 3000;

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cors());
const client = new speech.SpeechClient();
const upload = multer({ storage: multer.memoryStorage() });
const chunkUpload = multer({ storage: multer.memoryStorage() });

const TMP = "/tmp";
const SESSION_BUCKET = "zimulate";
const BUCKET_NAME = "zimulate";
const ROOT_FOLDER = "sessions";
const ELEVEN_API_KEY = "sk_c7b1c1925e918c3c7ae8a3007acf57f489fb4e099b151b8b";

const storage = new Storage();
const ttsClient = new TextToSpeechClient();

async function waitForAudio(
  conversationId,
  apiKey,
  maxRetries = 10,
  delayMs = 5000
) {
  logParameters({
    testLogID: testLogID,
    data: {
      " Waiting for audio for conversation ID": conversationId,
    },
  });
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const convoRes = await axios.get(
        `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`,
        { headers: { "xi-api-key": apiKey } }
      );
      const { message_count, status } = convoRes.data;

      logParameters({
        testLogID: testLogID,
        data: {
          Attempt: attempt,
          status: status,
          message_count: message_count,
        },
      });

      if (status === "done") {
        try {
          const audioRes = await axios.get(
            `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}/audio`,
            {
              headers: { "xi-api-key": apiKey },
              responseType: "arraybuffer",
            }
          );
          logParameters({
            testLogID: testLogID,
            data: {
              "Audio fetched successfully.": audioRes,
            },
          });
          return audioRes.data;
        } catch (err) {
          if (err.response?.status !== 404) throw err;
          logParameters({
            testLogID: testLogID,
            data: {
              "Audio not ready yet (404). Will retry...":
                "Audio not ready yet (404). Will retry...",
            },
          });
        }
      }
    } catch (err) {
      logParameters({
        testLogID: testLogID,
        data: {
          "Error checking conversation status:": err.messager,
        },
      });
    }
    await new Promise((res) => setTimeout(res, delayMs));
  }

  throw new Error("⏰ Timed out waiting for conversation audio.");
}

const getMediaDuration = (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
};

function getCurrentDateFormatted() {
  const today = new Date();

  const day = String(today.getDate()).padStart(2, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const year = today.getFullYear();

  return `${day}_${month}_${year}`;
}

function logParameters(logs) {
  const log = JSON.stringify(logs);
  console.log(log);
}

app.post("/conversation-token", async (req, res) => {
  const { agentId, testLogID } = req.body;

  try {
    const response = await fetch(
      "https://api.elevenlabs.io/v1/convai/conversation/token",
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVEN_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent_id: agentId || "agent_7601k24j14jtfv6s6m3r46bcafxq",
        }),
      }
    );

    const body = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: "Failed to get conversation token",
        details: body,
      });
    }

    if (!body.token) {
      return res.status(500).json({
        error: "No token returned from ElevenLabs",
        details: body,
      });
    }

    res.json({ token: body.token });
  } catch (err) {
    res.status(500).json({ error: "Server error", details: err.message });
  }
});


app.post("/upload-to-gcs", async (req, res) => {
  const {
    companyId,
    testName,
    email,
    attemptNo,
    agentId,
    sessionId,
    videoUrl,
    startTimeStamp,
    testLogID,
  } = req.body;

  try {
    let mergedPath;

    logParameters({
      testLogID: testLogID,
      data: {
        "upload-to-gcs req.body": req.body,
      },
    });

    if (videoUrl) {
      logParameters({
        testLogID: testLogID,
        data: {
          "Using merged video from URL": videoUrl,
        },
      });
      const tempDir = path.join(__dirname, "temp");
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

      mergedPath = path.join(tempDir, `merged-${sessionId}.webm`);
      const response = await axios.get(videoUrl, {
        responseType: "arraybuffer",
      });
      fs.writeFileSync(mergedPath, Buffer.from(response.data));
      logParameters({
        testLogID: testLogID,
        data: {
          "Downloaded merged video locally": mergedPath,
        },
      });
    } else {
      const chunkDir = path.join(TMP, ROOT_FOLDER, sessionId, "chunks");
      mergedPath = path.join(chunkDir, "merged.webm");

      if (!fs.existsSync(mergedPath)) {
        logParameters({
          testLogID: testLogID,
          data: {
            "Merged video not found at": mergedPath,
          },
        });
        return res.status(404).json({ error: "Merged video not found." });
      }
      logParameters({
        testLogID: testLogID,
        data: {
          "Found merged video locally": mergedPath,
        },
      });
    }

    const tempDir = path.join(__dirname, "temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const audioFileName = `audio-${uuidv4()}.mp3`;
    const sanitizedEmail = email.replace(/[@.]/g, "_");
    const finalFileName = `FinalVideo_${sanitizedEmail}_${attemptNo}.webm`;
    logParameters({
      testLogID: testLogID,
      data: {
        finalFileName: finalFileName,
      },
    });

    const tempAudioPath = path.join(tempDir, audioFileName);
    const tempMergedPath = path.join(tempDir, finalFileName);

    const convoListRes = await axios.get(
      "https://api.elevenlabs.io/v1/convai/conversations",
      {
        headers: { "xi-api-key": ELEVEN_API_KEY },
        params: { agent_id: agentId },
      }
    );

    const conversationId =
      convoListRes.data?.conversations?.[0]?.conversation_id;
    if (!conversationId) throw new Error("No conversation found.");
    logParameters({
      testLogID: testLogID,
      data: {
        "Using conversation ID:": convoListRes.data,
        testLogID: testLogID,
      },
    });

    // const convoTimeStamp = await axios.get(
    //   `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`,
    //   {
    //     headers: { "xi-api-key": ELEVEN_API_KEY },
    //     params: { agent_id: agentId },
    //   }
    // );

    // const offsetdiff =
    //   startTimeStamp - convoTimeStamp.metadata.start_time_unix_secs;

    // console.log("Offset", offsetdiff);

    const audioBuffer = await waitForAudio(conversationId, ELEVEN_API_KEY);
    fs.writeFileSync(tempAudioPath, audioBuffer);
    logParameters({
      testLogID: testLogID,
      data: {
        "Audio saved at:": tempAudioPath,
      },
    });

    const videoDuration = await getMediaDuration(mergedPath);
    const audioDuration = await getMediaDuration(tempAudioPath);
    // const offset = Math.max(videoDuration - audioDuration, 0).toFixed(2);
    const offset = 2;

    // console.log(` Video duration: ${videoDuration}s`);
    // console.log(` Audio duration: ${audioDuration}s`);
    // console.log(` Trimming first ${offset}s from video...`);

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(mergedPath)
        // .setStartTime(offset)
        .input(tempAudioPath)
        // .complexFilter(["[0:a][1:a]amix=inputs=2:duration=shortest[aout]"])
        .outputOptions([
          "-map 0:v:0",
          "-map 1:a:0",
          "-c:v libvpx",
          "-c:a libvorbis",
          "-shortest",
        ])
        .on("end", () => {
          logParameters({
            testLogID: testLogID,
            data: {
              "merged video+audio.": "merged video+audio.",
            },
          });

          resolve();
        })
        .on("error", (err) => {
          logParameters({
            testLogID: testLogID,
            data: {
              "ffmpeg error:": err.message,
            },
          });

          reject(err);
        })
        .save(tempMergedPath);
    });

    const gcsPath = `${companyId}/${testName}/${email}/${attemptNo}/${getCurrentDateFormatted()}/${finalFileName}`;
    logParameters({
      testLogID: testLogID,
      data: {
        "Uploading to GCS at:": gcsPath,
      },
    });

    await storage.bucket(BUCKET_NAME).upload(tempMergedPath, {
      destination: gcsPath,
      metadata: { contentType: "video/webm" },
    });

    const finalVideoUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${gcsPath}`;
    logParameters({
      testLogID: testLogID,
      data: {
        "Final video uploaded to GCS.": finalVideoUrl,
      },
    });

    [tempAudioPath, tempMergedPath, mergedPath].forEach((file) => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        logParameters({
          testLogID: testLogID,
          data: {
            "Deleted temp file:": file,
          },
        });
      }
    });

    try {
      await axios.delete(
        `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`,
        {
          headers: { "xi-api-key": ELEVEN_API_KEY },
        }
      );
      logParameters({
        testLogID: testLogID,
        data: {
          "Deleted conversation:": conversationId,
        },
      });

      await axios.delete(
        `https://api.elevenlabs.io/v1/convai/agents/${agentId}`,
        {
          headers: { "xi-api-key": ELEVEN_API_KEY },
        }
      );
      logParameters({
        testLogID: testLogID,
        data: {
          "Deleted agent :": agentId,
        },
      });
    } catch (err) {
      logParameters({
        testLogID: testLogID,
        data: {
          "Failed to Delete agent :": err.message,
        },
      });
    }
    logParameters({
      testLogID: testLogID,
      data: { finalVideoUrl: finalVideoUrl },
    });

    res.json({
      success: true,
      gcsPath,
      videoUrl: finalVideoUrl,
    });
  } catch (err) {
    logParameters({
      testLogID: testLogID,
      data: {
        "Error in upload-to-gcs handler": err.message,
      },
    });
    res.status(500).json({ error: err.message });
  }
});

app.post("/uploadChunk", chunkUpload.single("chunk"), async (req, res) => {
  const { index, totalChunks, sessionId, testLogID } = req.body;

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
  logParameters({
    testLogID: testLogID,
    data: {
      "Received chunk": index,
      sessionId: sessionId,
      receivedChunks: receivedChunks,
      totalChunks: totalChunks,
    },
  });

  if (receivedChunks == parseInt(totalChunks)) {
    logParameters({
      testLogID: testLogID,
      data: {
        "All chunks received. Starting merge...":
          "All chunks received. Starting merge...",
      },
    });
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

      logParameters({
        testLogID: testLogID,
        data: {
          "Merged video uploaded to gs:": `gs://${SESSION_BUCKET}/${gcsPath}`,
        },
      });
      res.status(200).json({
        message: "Chunks uploaded and video merged.",
        videoUrl: `https://storage.googleapis.com/${SESSION_BUCKET}/${gcsPath}`,
      });
    });

    writeStream.on("error", (err) => {
      logParameters({
        testLogID: testLogID,
        data: {
          "Failed to merge chunks:": err,
        },
      });
      res.status(500).send("Failed to merge chunks.");
    });
  } else {
    res.status(200).send("Chunk received");
  }
});

app.post("/log", (req, res) => {
  const params = req.body;

  if (!params || typeof params !== "object") {
    return res
      .status(400)
      .json({ error: "Invalid parameters. Send a JSON object." });
  }

  logParameters(params);

  res.json({ status: "Parameters logged successfully" });
});

const SCOPES = ["https://www.googleapis.com/auth/gmail.send"];

const auth = new google.auth.GoogleAuth({
  keyFile: "speech-to-text-key.json",
  scopes: SCOPES,
});

app.post("/send-email", async (req, res) => {
  try {
    const { name, email, message } = req.body;
    const client = await auth.getClient();
    const gmail = google.gmail({ version: "v1", auth: client });

    const rawMessage = [
      `To: contact@thev2technologies.com`,
      `Subject: New Contact Form Submission`,
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      `Name: ${name}`,
      `Email: ${email}`,
      `Message: ${message}`,
    ].join("\n");

    const encodedMessage = Buffer.from(rawMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedMessage,
      },
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Email send error:", error);
    res.status(500).json({ success: false, message: "Failed to send email" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
