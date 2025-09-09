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
const { TranscoderServiceClient } = require("@google-cloud/video-transcoder");
const { spawn } = require("child_process");
const os = require("os");
const fsp = fs.promises;

const PORT = 3000;

const app = express();

app.use(cors());
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb", extended: true }));
const chunkUpload = multer({ storage: multer.memoryStorage() });
const upload = multer();

const TMP = "/tmp";
const SESSION_BUCKET = "zimulate";
const BUCKET_NAME = "zimulate";
const ROOT_FOLDER = "sessions";
const ELEVEN_API_KEY = "sk_c7b1c1925e918c3c7ae8a3007acf57f489fb4e099b151b8b";
const PROJECT_ID = "contactaiassessments";
const LOCATION = "asia-south1";
const storage = new Storage();
const transcoderServiceClient = new TranscoderServiceClient();

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
      const tranScriptRes = await axios.get(
        `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`,
        {
          headers: { "xi-api-key": apiKey },
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
      logParameters({
        testLogID: testLogID,
        data: {
          step: `Transcript for convoID ${conversationId}`,
          side: "server",
          transcript: tranScriptRes.data.transcript.map((el) => el.message),
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

async function logParameters(params) {
  try {
    const response = await axios.post(
      "https://cloud-run-logger-953332685815.asia-south1.run.app/log",
      params
    );
    console.log("Response from server:", response.data);
  } catch (error) {
    console.error("Error sending log parameters:", error.message);
  }
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
    let uniqID = uuidv4();
    logParameters({
      testLogID: testLogID,
      data: {
        step: "upload-to-gcs req.body",
        side: "server",
        "upload-to-gcs req.body": req.body,
      },
    });

    // if (videoUrl) {
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

    mergedPath = path.join(tempDir, `merged-${uniqID}.webm`);
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
    // } else {
    //   const chunkDir = path.join(TMP, ROOT_FOLDER, sessionId, "chunks");
    //   mergedPath = path.join(chunkDir, "merged.webm");

    //   if (!fs.existsSync(mergedPath)) {
    //     logParameters({
    //       testLogID: testLogID,
    //       data: {
    //         step: "Merged video not found at",
    //         side: "server",
    //         "Merged video not found at": mergedPath,
    //       },
    //     });
    //     return res.status(404).json({ error: "Merged video not found." });
    //   }
    //   logParameters({
    //     testLogID: testLogID,
    //     data: {
    //       step: "Found merged video locally",
    //       side: "server",
    //       "Found merged video locally": mergedPath,
    //     },
    //   });
    // }

    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const audioFileName = `audio-${uniqID}.mp3`;
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

    logParameters({
      testLogID: testLogID,
      data: {
        step: `Convo List for agent for ${agentId}`,
        side: "server",
        convoListRes: convoListRes.data,
      },
    });

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
        .on("error", (err, stdout, stderr) => {
          logParameters({
            testLogID,
            data: {
              step: "ffmpeg error",
              side: "server",
              message: err?.message || "Unknown error",
              stdout: stdout,
              stderr: stderr,
            },
          });
        })

        .save(tempMergedPath);
    });

    const gcsPath = `${companyId}/${testName}/${email}/${attemptNo}-${uniqID}/${getCurrentDateFormatted(
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
      chunkDir: chunkDir,
      chunkPath: chunkPath,
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

  const allFiles = fs.readdirSync(chunkDir);

  const chunkFiles = allFiles
    .filter((f) => f.startsWith("chunk_"))
    .filter((file) => {
      try {
        fs.accessSync(path.join(chunkDir, file), fs.constants.R_OK);
        return true;
      } catch {
        logParameters({
          testLogID: testLogID,
          data: {
            step: "Failed chunks",
            side: "server",
            sessionId: sessionId,
            file: file,
          },
        });
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
      allFiles: allFiles,
    },
  });

  if (parseInt(index) + 1 == parseInt(totalChunks)) {
    logParameters({
      testLogID: testLogID,
      data: {
        step: "All chunks received. Starting merge",
        side: "server",
        condition: `${parseInt(index) + 1} == ${parseInt(totalChunks)}`,
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
      res.status(500).send({ message: "Failed to merge chunks." });
    });
  } else {
    res.status(200).send({ message: "Chunk received" });
    logParameters({
      testLogID: testLogID,
      data: {
        step: "Chunk received",
        side: "server",
      },
    });
  }
});

app.post("/uploadChunk1", chunkUpload.single("chunk"), async (req, res) => {
  const { index, sessionId, testLogID } = req.body;
  logParameters({
    testLogID: testLogID,
    data: {
      step: "uploadChunk called",
      side: "server",
      index: index,
      sessionId: sessionId,
    },
  });
  if (!index || !sessionId || !req.file) {
    return res.status(400).send("Missing required fields or file.");
  }

  const chunkDir = path.join(TMP, ROOT_FOLDER, sessionId, "chunks");
  fs.mkdirSync(chunkDir, { recursive: true });
  const chunkPath = path.join(chunkDir, `chunk_${index}`);
  fs.writeFileSync(chunkPath, req.file.buffer);

  logParameters({
    testLogID: testLogID,
    data: {
      step: "Received Chunk",
      side: "server",
      index: index,
      sessionId: sessionId,
      chunkDir: chunkDir,
      chunkPath: chunkPath,
    },
  });

  res.status(200).send({ message: `Chunk ${index} received` });
});

app.post("/finalizeUpload1", async (req, res) => {
  const { testLogID, sessionId } = req.body;
  logParameters({
    testLogID: testLogID,
    data: {
      step: "Finalize Chunks",
      side: "server",
      sessionId: sessionId,
    },
  });
  if (!sessionId) {
    return res.status(400).send("Missing sessionId");
  }

  const chunkDir = path.join(TMP, ROOT_FOLDER, sessionId, "chunks");
  const chunkFiles = fs
    .readdirSync(chunkDir)
    .filter((f) => f.startsWith("chunk_"))
    .sort((a, b) => parseInt(a.split("_")[1]) - parseInt(b.split("_")[1]));

  const mergedPath = path.join(chunkDir, "merged.webm");
  const writeStream = fs.createWriteStream(mergedPath);

  logParameters({
    testLogID: testLogID,
    data: {
      step: "Finalizing Chunks",
      side: "server",
      sessionId: sessionId,
      chunkDir: chunkDir,
      chunkFiles: chunkFiles,
      mergedPath: mergedPath,
    },
  });

  for (const file of chunkFiles) {
    logParameters({
      testLogID: testLogID,
      data: {
        step: "Finalizing Chunks Loop",
        side: "server",
        sessionId: sessionId,
      },
    });
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
        step: "Finalized Chunks",
        side: "server",
        sessionId: sessionId,
        gcsPath: gcsPath,
      },
    });
    res.status(200).json({
      message: "Video finalized and uploaded",
      videoUrl: `https://storage.googleapis.com/${SESSION_BUCKET}/${gcsPath}`,
    });
  });

  writeStream.on("error", (err) => {
    logParameters({
      testLogID: testLogID,
      data: {
        step: "Finalized Chunks failed",
        side: "server",
        sessionId: sessionId,
        err: err,
      },
    });
    console.error("❌ Merge error:", err);
    res.status(500).send({ message: "Failed to merge chunks" });
  });
});

app.post("/uploadChunk2", upload.single("chunk"), async (req, res) => {
  try {
    const { sessionId, index, testName, testLogID, email, attempt } = req.body;
    if (!req.file || !sessionId || !index) {
      return res
        .status(400)
        .json({ error: "Missing required fields or file." });
    }

    const bucket = storage.bucket(SESSION_BUCKET);
    const filePath = `${ROOT_FOLDER}/${testName}/${email}/${attempt}-${sessionId}/chunks/chunk_${index}.webm`;

    await bucket.file(filePath).save(req.file.buffer, {
      contentType: "video/webm",
    });

    logParameters({
      testLogID: testLogID,
      data: {
        step: `✅ Uploaded chunk ${index} for session ${sessionId} at ${filePath}`,
        side: "server",
      },
    });
    res.json({ success: true, path: filePath });
  } catch (err) {
    logParameters({
      testLogID: testLogID,
      data: {
        step: "Chunks Fail",
        side: "server",
        err: err,
      },
    });
    console.error("❌ uploadChunk2 error", err);
    res.status(500).json({ error: "Failed to upload chunk" });
  }
});

const tmpDir = (...p) => path.join(os.tmpdir(), ...p);

const ensureDir = async (dir) => {
  await fsp.mkdir(dir, { recursive: true });
};

const safeUnlink = async (p) => {
  try {
    await fsp.unlink(p);
  } catch {}
};

const sanitizeEmail = (email) =>
  String(email || "").replace(/[^a-zA-Z0-9._-]/g, "_");

const dateStamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(
    d.getHours()
  )}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
};

const cleanupElevenLabs = async ({ conversationId, agentId, testLogID }) => {
  const headers = { "xi-api-key": ELEVEN_API_KEY };

  if (conversationId) {
    try {
      await axios.delete(
        `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`,
        { headers }
      );
      logParameters({
        testLogID,
        data: { step: "Deleted conversation", side: "server", conversationId },
      });
    } catch (err) {
      logParameters({
        testLogID,
        data: {
          step: "Delete conversation failed",
          side: "server",
          error: err?.response?.data || err.message,
        },
      });
    }
  }

  if (agentId) {
    try {
      await axios.delete(
        `https://api.elevenlabs.io/v1/convai/agents/${agentId}`,
        { headers }
      );
      logParameters({
        testLogID,
        data: { step: "Deleted agent", side: "server", agentId },
      });
    } catch (err) {
      logParameters({
        testLogID,
        data: {
          step: "Delete agent failed",
          side: "server",
          error: err?.response?.data || err.message,
        },
      });
    }
  }
};

const downloadAllChunks = async (
  sessionId,
  testLogID,
  testName,
  email,
  attemptNo
) => {
  const prefix = `${ROOT_FOLDER}/${testName}/${email}/${attemptNo}-${sessionId}/chunks/`;
  const [files] = await storage.bucket(SESSION_BUCKET).getFiles({ prefix });

  const chunkFiles = files
    .filter((f) => /\/chunk_\d+\.webm$/.test(f.name))
    .sort((a, b) => {
      const ai = parseInt(a.name.match(/chunk_(\d+)\.webm$/)[1], 10);
      const bi = parseInt(b.name.match(/chunk_(\d+)\.webm$/)[1], 10);
      return ai - bi;
    });

  if (chunkFiles.length === 0) {
    throw new Error("No video chunks found in bucket.");
  }

  const localDir = tmpDir("merge", sessionId, "chunks");
  await ensureDir(localDir);

  const localPaths = [];
  const cloudPaths = [];
  for (const f of chunkFiles) {
    const filename = path.basename(f.name);
    const dest = path.join(localDir, filename);
    await f.download({ destination: dest });
    localPaths.push(dest);
    cloudPaths.push(f.name);
  }

  logParameters({
    testLogID,
    data: {
      step: "Chunks downloaded",
      side: "server",
      count: localPaths.length,
      cloudPaths,
      localPaths,
    },
  });

  return { localDir, localPaths };
};

const mergeChunksWithFFmpeg = async ({ localDir, localPaths, testLogID }) => {
  const concatStr = localPaths.join("|");

  const mergedPath = path.join(localDir, "merged.webm");
  const args = [
    "-i",
    `concat:${concatStr}`,
    "-c:v",
    "libvpx-vp9",
    "-c:a",
    "libopus",
    "-y",
    mergedPath,
  ];

  logParameters({
    testLogID,
    data: {
      step: "Running ffmpeg merge (concat protocol)",
      side: "server",
      args,
      concatStr,
    },
  });

  await runFFmpeg(args, localDir, testLogID);

  return mergedPath;
};

const mergeChunksByAppending = async ({ localDir, localPaths, testLogID }) => {
  const mergedPath = path.join(localDir, "merged.webm");
  // const outStream = fs.createWriteStream(mergedPath);

  for (const file of localPaths) {
    logParameters({
      testLogID,
      data: {
        step: "Appending chunk",
        side: "server",
        file,
      },
    });

    const data = fs.readFileSync(file);
    fs.appendFileSync(mergedPath, data);
    // outStream.write(data);
  }
  if (fs.existsSync(mergedPath)) {
    logParameters({
      testLogID,
      data: {
        step: "Merged file exists",
        side: "server",
        mergedPath,
        date: new Date(),
      },
    });
  }

  // outStream.end();

  logParameters({
    testLogID,
    data: {
      step: "All chunks appended",
      side: "server",
      mergedPath,
    },
  });

  return mergedPath;
};

const runFFmpeg = (args, cwd, testLogID) => {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", args, { cwd });

    ffmpeg.stdout.on("data", (data) => {
      logParameters({
        testLogID,
        data: { step: "ffmpeg stdout", side: "server", log: data.toString() },
      });
    });

    ffmpeg.stderr.on("data", (data) => {
      logParameters({
        testLogID,
        data: { step: "ffmpeg stderr", side: "server", log: data.toString() },
      });
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
};

const fetchAndStoreAudio = async ({
  agentId,
  sessionId,
  testLogID,
  testName,
  email,
  attemptNo,
}) => {
  const headers = { "xi-api-key": ELEVEN_API_KEY };
  const convoListRes = await axios.get(
    "https://api.elevenlabs.io/v1/convai/conversations",
    { headers, params: { agent_id: agentId } }
  );

  const conversationId = convoListRes.data?.conversations?.[0]?.conversation_id;
  if (!conversationId) throw new Error("No conversation found for agent.");

  logParameters({
    testLogID,
    data: {
      step: "Convo List",
      side: "server",
      convoListRes: convoListRes,
    },
  });

  const audioBuffer = await waitForAudio(
    conversationId,
    ELEVEN_API_KEY,
    testLogID
  );

  const audioLocalDir = tmpDir("merge", sessionId, "audio");
  await ensureDir(audioLocalDir);
  const audioLocalPath = path.join(audioLocalDir, "audio.webm");
  await fsp.writeFile(audioLocalPath, audioBuffer);

  const audioGcsPath = `${ROOT_FOLDER}/${testName}/${email}/${attemptNo}-${sessionId}/audio/audio.webm`;
  await storage
    .bucket(SESSION_BUCKET)
    .file(audioGcsPath)
    .save(audioBuffer, { contentType: "audio/webm" });

  logParameters({
    testLogID,
    data: {
      step: "Audio saved",
      side: "server",
      audioLocalPath,
      audioGcsPath,
      conversationId,
    },
  });

  return { audioLocalPath, conversationId };
};

const muxVideoAndAudio = async ({
  mergedVideoPath,
  audioLocalPath,
  sessionId,
  testLogID,
}) => {
  return new Promise(async (resolve, reject) => {
    logParameters({
      testLogID,
      data: { step: "muxVideoAndAudio", side: "server" },
    });
    const outDir = tmpDir("merge", sessionId, "out");
    await ensureDir(outDir);
    const finalLocalPath = path.join(outDir, "final.webm");

    const args = [
      "-itsoffset",
      "1.6",
      "-i",
      mergedVideoPath,
      "-i",
      audioLocalPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libvpx",
      "-c:a",
      "libvorbis",
      "-shortest",
      "-y",
      finalLocalPath,
    ];

    await runFFmpeg(args, outDir, testLogID);

    const watcher = fs.watch(outDir, (eventType, filename) => {
      if (filename === "final.webm" && fs.existsSync(finalLocalPath)) {
        watcher.close();
        logParameters({
          testLogID,
          data: {
            step: "Muxed final A/V (re-encoded like fluent-ffmpeg) File Found",
            side: "server",
            finalLocalPath,
          },
        });
        resolve(finalLocalPath);
      }
    });

    setTimeout(() => {
      watcher.close();
      logParameters({
        testLogID,
        data: {
          step: "Muxed final A/V (re-encoded like fluent-ffmpeg) Failed Path Not found",
          side: "server",
          finalLocalPath,
        },
      });
      reject(new Error("Timeout waiting for final video file"));
    }, 30000);
  });
};

const uploadFinalVideo = async ({
  localPath,
  companyId,
  testName,
  email,
  attemptNo,
  testLogID,
}) => {
  logParameters({
    testLogID,
    data: { step: "uploadFinalVideo", side: "server" },
  });

  const sanitized = sanitizeEmail(email);
  const finalFileName = `FinalVideo_${sanitized}_${attemptNo}.webm`;

  const uniqFolder = `${attemptNo}-${Date.now()}`;
  const dated = dateStamp();
  const gcsPath = `${companyId}/${testName}/${sanitized}/${uniqFolder}/${dated}/${finalFileName}`;

  await storage.bucket(SESSION_BUCKET).upload(localPath, {
    destination: gcsPath,
    contentType: "video/webm",
    resumable: false,
  });

  const publicUrl = `https://storage.googleapis.com/${SESSION_BUCKET}/${gcsPath}`;

  logParameters({
    testLogID,
    data: { step: "Final video uploaded", side: "server", gcsPath, publicUrl },
  });

  return { gcsPath, publicUrl };
};

app.post("/finalizeUpload2", async (req, res) => {
  const {
    companyId,
    testName,
    email,
    attemptNo,
    agentId,
    sessionId,
    testLogID,
    firstName,
    lastName,
    token,
    persona,
  } = req.body || {};

  const ctx = {
    companyId,
    testName,
    email,
    attemptNo,
    agentId,
    sessionId,
    testLogID,
  };

  try {
    if (
      !sessionId ||
      !agentId ||
      !email ||
      !companyId ||
      !testName ||
      !attemptNo
    ) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    logParameters({
      testLogID,
      data: { step: "Finalize start", side: "server", ctx },
    });

    const { localDir, localPaths } = await downloadAllChunks(
      sessionId,
      testLogID,
      testName,
      email,
      attemptNo
    );
    // const mergedVideoPath = await mergeChunksWithFFmpeg({
    //   localDir,
    //   localPaths,
    //   testLogID,
    // });
    const mergedVideoPath = await mergeChunksByAppending({
      localDir,
      localPaths,
      testLogID,
    });
    const { audioLocalPath, conversationId } = await fetchAndStoreAudio({
      agentId,
      sessionId,
      testLogID,
      testName,
      email,
      attemptNo,
    });

    const finalLocalPath = await muxVideoAndAudio({
      mergedVideoPath,
      audioLocalPath,
      sessionId,
      testLogID,
    });

    const { gcsPath, publicUrl, signedUrl } = await uploadFinalVideo({
      localPath: finalLocalPath,
      companyId,
      testName,
      email,
      attemptNo,
      testLogID,
    });

    const urlForInsights = signedUrl || publicUrl;
    setImmediate(async () => {
      try {
        await getSessionInsights(
          urlForInsights,
          email,
          firstName,
          lastName,
          testName,
          attemptNo,
          token,
          persona,
          testLogID
        );
      } catch (e) {
        logParameters({
          testLogID,
          data: {
            step: "Insights failed",
            side: "server",
            error: e?.response?.data || e.message,
          },
        });
      }
    });

    setImmediate(() =>
      cleanupElevenLabs({ conversationId, agentId, testLogID })
    );

    res.json({
      success: true,
      finalVideoUrl: publicUrl,
      signedUrl,
      gcsPath,
    });

    setImmediate(async () => {
      try {
        await Promise.all(
          [...localPaths, mergedVideoPath, audioLocalPath, finalLocalPath].map(
            (p) => safeUnlink(p)
          )
        );
      } catch {}
      try {
        await fsp.rm(path.dirname(path.dirname(localDir)), {
          recursive: true,
          force: true,
        });
      } catch {}
    });
  } catch (err) {
    logParameters({
      testLogID,
      data: {
        step: "Finalize failed",
        side: "server",
        error: err?.stderr || err?.response?.data || err.message,
      },
    });
    console.error("❌ Finalize failed:", err?.stderr || err);
    res.status(500).json({ error: "Failed to finalize upload" });
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
