require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { Storage } = require("@google-cloud/storage");
const util = require("util");
const cors = require("cors");
const { google } = require("googleapis");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const ffmpeg = require("fluent-ffmpeg");

const PORT = 3000;

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cors());
const chunkUpload = multer({ storage: multer.memoryStorage() });

const TMP = "/tmp";
const SESSION_BUCKET = "zimulate";
const BUCKET_NAME = "zimulate";
const ROOT_FOLDER = "sessions";
const ELEVEN_API_KEY = "sk_c7b1c1925e918c3c7ae8a3007acf57f489fb4e099b151b8b";

const storage = new Storage();

async function waitForAudio(conversationId, apiKey, testLogID) {
  logParameters({
    testLogID: testLogID,
    data: {
      step: "Waiting for audio for conversation ID",
      side: "server",
      " Waiting for audio for conversation ID": conversationId,
    },
  });
  let convoRes;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      convoRes = await axios.get(
        `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`,
        { headers: { "xi-api-key": apiKey } }
      );
      const { message_count, status } = convoRes.data;

      logParameters({
        testLogID: testLogID,
        data: {
          step: "Fetching details for audio",
          side: "server",
          Attempt: attempt,
          status: status,
          message_count: message_count,
          maxRetries: maxRetries,
          condition: attempt <= maxRetries,
        },
      });

      if (status == "done") {
        break;
      }
    } catch (err) {
      logParameters({
        testLogID: testLogID,
        data: {
          step: "Error checking conversation status",
          side: "server",
          "Error checking conversation status:": err,
        },
      });
    }
    await new Promise((res) => setTimeout(res, 5000));
  }

  if (convoRes.data.status === "done") {
    try {
      logParameters({
        testLogID: testLogID,
        data: {
          step: "Fetching audio",
          side: "server",
          conversationId: conversationId,
        },
      });
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
          step: "Fetched audio",
          side: "server",
          "Audio fetched successfully.": true,
        },
      });
      return audioRes.data;
    } catch (err) {
      if (err.response?.status !== 404) throw err;
      logParameters({
        testLogID: testLogID,
        data: {
          step: "Audio not ready yet (404). Will retry",
          side: "server",
        },
      });
    }
  } else throw new Error("⏰ Timed out waiting for conversation audio.");
}

function getCurrentDateFormatted(testLogID) {
  const today = new Date();

  const day = String(today.getDate()).padStart(2, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const year = today.getFullYear();
  logParameters({
    testLogID: testLogID,
    data: {
      step: "Current Date",
      side: "server",
      date: `${day}_${month}_${year}`,
    },
  });
  return `${day}_${month}_${year}`;
}

async function getSessionInsights(
  url,
  email,
  firstName,
  lastName,
  testName,
  attemptNo,
  token,
  persona,
  testLogID
) {
  try {
    logParameters({
      testLogID: testLogID,
      data: {
        step: "Inside Result API",
        side: "Client",
      },
    });
    const response = await axios.post(
      "https://zimulate.me:99/submit-video-google",
      "",
      {
        headers: { "Content-Type": "application/json" },
        params: {
          email,
          firstName,
          lastName,
          testName,
          attempt: attemptNo,
          companyId: "LTI",
          googleBucketPath: url,
          token,
          model: "gemini-2.5-pro",
          location: "us-central1",
          persona: persona,
        },
      }
    );

    if (response.status == 200) {
      logParameters({
        testLogID: testLogID,
        data: {
          step: "Results API called successfully",
          side: "Client",
          insights: response.data,
        },
      });
    }
  } catch (error) {
    console.error(error);
    logParameters({
      testLogID: testLogID,
      data: {
        step: "Result API call failed",
        side: "Client",
        insightsError: error,
      },
    });
  }
}

function logParameters(logs) {
  const log = JSON.stringify(logs);
  console.log(log);
}

app.post("/conversation-token", async (req, res) => {
  const { agentId, testLogID } = req.body;
  logParameters({
    testLogID: testLogID,
    data: {
      step: "get token called",
      side: "server",
    },
  });
  try {
    const response = await fetch(
      "https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=" +
        (agentId || "agent_7601k24j14jtfv6s6m3r46bcafxq"),
      {
        method: "get",
        headers: {
          "xi-api-key": ELEVEN_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const body = await response.json();

    if (!response.ok) {
      logParameters({
        testLogID: testLogID,
        data: {
          step: "11labs Token failed",
          side: "server",
          "11labs Token failed": body,
        },
      });

      return res.status(500).json({
        error: "Failed to get conversation token",
        details: body,
      });
    }

    if (!body.token) {
      logParameters({
        testLogID: testLogID,
        data: {
          step: "11labs Token failed",
          side: "server",
          "NO Token available": body,
        },
      });

      return res.status(500).json({
        error: "No token returned from ElevenLabs",
        details: body,
      });
    }
    logParameters({
      testLogID: testLogID,
      data: {
        step: "11labs Token successful",
        side: "server",
        "Token available": body,
      },
    });
    res.json({ token: body.token });
  } catch (err) {
    logParameters({
      testLogID: testLogID,
      data: {
        step: "11labs Token failed",
        side: "server",
        "Token failed": err,
      },
    });
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
    firstName,
    lastName,
    token,
    persona,
  } = req.body;

  try {
    let mergedPath;

    logParameters({
      testLogID: testLogID,
      data: {
        step: "upload-to-gcs req.body",
        side: "server",
        "upload-to-gcs req.body": req.body,
      },
    });

    if (videoUrl) {
      logParameters({
        testLogID: testLogID,
        data: {
          step: "Using merged video from URL",
          side: "server",
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
          step: "Downloaded merged video locally",
          side: "server",
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
            step: "Merged video not found at",
            side: "server",
            "Merged video not found at": mergedPath,
          },
        });
        return res.status(404).json({ error: "Merged video not found." });
      }
      logParameters({
        testLogID: testLogID,
        data: {
          step: "Found merged video locally",
          side: "server",
          "Found merged video locally": mergedPath,
        },
      });
    }

    const tempDir = path.join(__dirname, "temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const audioFileName = `audio-${uuidv4()}.mp3`;
    const sanitizedEmail = email.replace(/[@.]/g, "_");
    const finalFileName = `FinalVideo_${sanitizedEmail}_${attemptNo}.webm`;
    const tempAudioPath = path.join(tempDir, audioFileName);
    const tempMergedPath = path.join(tempDir, finalFileName);

    logParameters({
      testLogID: testLogID,
      data: {
        step: "setting the final output video name",
        side: "server",
        finalFileName: finalFileName,
      },
    });

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
        step: "fetched conversation ID for agent",
        side: "server",
        "fetched conversation ID for agent:": convoListRes.data,
        testLogID: testLogID,
      },
    });

    const audioBuffer = await waitForAudio(
      conversationId,
      ELEVEN_API_KEY,
      testLogID
    );

    fs.writeFileSync(tempAudioPath, audioBuffer);

    logParameters({
      testLogID: testLogID,
      data: {
        step: "Convo Audio saved",
        side: "server",
        "Audio saved at:": tempAudioPath,
      },
    });

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(mergedPath)
        .input(tempAudioPath)
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
              step: "merged video+audio",
              side: "server",
            },
          });

          resolve();
        })
        .on("error", (err) => {
          logParameters({
            testLogID: testLogID,
            data: {
              step: "ffmpeg error",
              side: "server",
              "ffmpeg error:": err,
            },
          });

          reject(err);
        })
        .save(tempMergedPath);
    });

    const gcsPath = `${companyId}/${testName}/${email}/${attemptNo}/${getCurrentDateFormatted(
      testLogID
    )}/${finalFileName}`;

    logParameters({
      testLogID: testLogID,
      data: {
        step: "Uploading Final Video to GCS",
        side: "server",
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
        step: "Uploaded Final Video to GCS",
        side: "server",
        "Final video uploaded to GCS.": finalVideoUrl,
      },
    });

    [tempAudioPath, tempMergedPath, mergedPath].forEach((file) => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        logParameters({
          testLogID: testLogID,
          data: {
            step: "Deleted the temp files",
            side: "server",
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
          step: "Deleted convo",
          side: "server",
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
          step: "Deleted agent",
          side: "server",
          "Deleted agent :": agentId,
        },
      });
    } catch (err) {
      logParameters({
        testLogID: testLogID,
        data: {
          step: "failed to delete agent",
          side: "server",
          "Failed to Delete agent :": err.message,
        },
      });
    }
    logParameters({
      testLogID: testLogID,
      data: {
        step: "Final Video URL",
        side: "server",
        finalVideoUrl: finalVideoUrl,
      },
    });

    getSessionInsights(
      finalVideoUrl,
      email,
      firstName,
      lastName,
      testName,
      attemptNo,
      token,
      persona,
      testLogID
    );

    res.json({
      success: true,
      gcsPath,
      videoUrl: finalVideoUrl,
    });
  } catch (err) {
    logParameters({
      testLogID: testLogID,
      data: {
        step: "Error in upload-to-gcs",
        side: "server",
        "Error in upload-to-gcs handler": JSON.stringify(err),
      },
    });
    res.status(500).json({ error: err.message });
  }
});

app.post("/uploadChunk", chunkUpload.single("chunk"), async (req, res) => {
  const { index, totalChunks, sessionId, testLogID } = req.body;
  logParameters({
    testLogID: testLogID,
    data: {
      step: "uploadChunk called",
      side: "server",
      index: index,
      totalChunks: totalChunks,
      sessionId: sessionId,
    },
  });
  if (!index || !totalChunks || !sessionId || !req.file) {
    return res.status(400).send("Missing required fields or file.");
  }

  const chunkDir = path.join(TMP, ROOT_FOLDER, sessionId, "chunks");
  fs.mkdirSync(chunkDir, { recursive: true });

  logParameters({
    testLogID: testLogID,
    data: {
      step: "dir path",
      side: "server",
      "Received chunk": index,
      chunkDir: chunkDir,
      totalChunks: totalChunks,
    },
  });

  const chunkPath = path.join(chunkDir, `chunk_${index}`);
  fs.writeFileSync(chunkPath, req.file.buffer);

  logParameters({
    testLogID: testLogID,
    data: {
      step: "dir path",
      side: "server",
      "Received chunk": index,
      chunkPath: chunkDir,
      totalChunks: totalChunks,
    },
  });

  const receivedChunks = fs
    .readdirSync(chunkDir)
    .filter((f) => f.startsWith("chunk_")).length;

  let isAccessible = false;
  try {
    fs.accessSync(chunkPath, fs.constants.R_OK);
    isAccessible = true;
  } catch (err) {
    console.error(`❌ Chunk ${index} is not accessible:`, err.message);
  }

  const chunkFiles = fs
    .readdirSync(chunkDir)
    .filter((f) => f.startsWith("chunk_"))
    .filter((file) => {
      try {
        fs.accessSync(path.join(chunkDir, file), fs.constants.R_OK);
        return true;
      } catch {
        return false;
      }
    });

  logParameters({
    testLogID: testLogID,
    data: {
      step: "Receiving chunks",
      side: "server",
      "Received chunk": index,
      sessionId: sessionId,
      receivedChunks: receivedChunks,
      totalChunks: totalChunks,
      " Saved chunk": `${chunkPath} is Accessible: ${isAccessible}`,
      chunkList: chunkFiles,
    },
  });

  if (index + 1 == parseInt(totalChunks)) {
    logParameters({
      testLogID: testLogID,
      data: {
        step: "All chunks received. Starting merge",
        side: "server",
        condition: `${index + 1} == ${parseInt(totalChunks)}`,
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
          step: "Merged video uploaded to gs",
          side: "server",
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
          step: "Failed to merge chunks",
          side: "server",
          "Failed to merge chunks:": err,
        },
      });
      res.status(500).send("Failed to merge chunks.");
    });
  } else {
    res.status(200).send("Chunk received");
    logParameters({
      testLogID: testLogID,
      data: {
        step: "Chunk received",
        side: "server",
      },
    });
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
