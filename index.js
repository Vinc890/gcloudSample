require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { Storage } = require("@google-cloud/storage");
const cors = require("cors");
const { google } = require("googleapis");
const axios = require("axios");
const { spawn } = require("child_process");
const os = require("os");
const fsp = fs.promises;

const PORT = 3000;

const app = express();

app.use(cors());
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb", extended: true }));
const upload = multer();

const SESSION_BUCKET = "zimulate";
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
    params.serverDateOfLogging = new Date();

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
        logParameters({
          testLogID,
          data: {
            step: "ffmpeg resolved",
            side: "server",
            code: code,
          },
        });
        resolve();
      } else {
        logParameters({
          testLogID,
          data: {
            step: "ffmpeg rejected",
            side: "server",
            code: code,
          },
        });
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

  storage
    .bucket(SESSION_BUCKET)
    .file(audioGcsPath)
    .save(audioBuffer, { contentType: "audio/webm" })
    .then(() => {
      logParameters({
        testLogID,
        data: {
          step: "Audio upload success",
          side: "server",
          audioGcsPath,
        },
      });
    })
    .catch((err) => {
      logParameters({
        testLogID,
        data: {
          step: "Audio upload failed",
          side: "server",
          error: err.message,
          audioGcsPath,
        },
      });
    });

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
  logParameters({
    testLogID,
    data: { step: "muxVideoAndAudio", side: "server" },
  });
  const outDir = tmpDir("merge", sessionId, "out");
  await ensureDir(outDir);
  const finalLocalPath = path.join(outDir, "final.webm");
  let counter = 0;

  const args = [
    "-hide_banner",
    "-loglevel",
    "warning",
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

  await runFFmpeg(args, outDir);

  logParameters({
    testLogID,
    data: {
      step: "Muxed final A/V file",
      side: "server",
      finalLocalPath,
    },
  });

  let fileExists = false;

  const fileCheckInterval = setInterval(() => {
    if (counter >= 12) {
      if (fs.existsSync(finalLocalPath)) {
        logParameters({
          testLogID,
          data: {
            step: "Final file exists",
            side: "server",
            mergedPath,
            date: new Date(),
          },
        });
        fileExists = true;
        clearInterval(fileCheckInterval);
      }
      counter++;
    } else {
      clearInterval(fileCheckInterval);
    }
  }, 5000);

  if (fileExists) {
    return finalLocalPath;
  } else {
    throw new Error(
      `Final muxed file not found after ffmpeg. ${finalLocalPath}`
    );
  }
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
    requestID,
  } = req.body || {};

  const ctx = {
    companyId,
    testName,
    email,
    attemptNo,
    agentId,
    sessionId,
    testLogID,
    requestID,
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
