require("dotenv").config();
const express = require("express");
const multer = require("multer");
const { Storage } = require("@google-cloud/storage");
const cors = require("cors");
const { google } = require("googleapis");
const axios = require("axios");

const PORT = 3000;

const app = express();

app.use(cors());
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb", extended: true }));
const upload = multer();

const SESSION_BUCKET = "zimulate";
const ROOT_FOLDER = "sessions";
const ELEVEN_API_KEY = "sk_c7b1c1925e918c3c7ae8a3007acf57f489fb4e099b151b8b";
const ELEVEN_LABS_BASE_URL = "https://api.elevenlabs.io/v1/convai";
const PUBLIC_JSON_URL =
  "https://storage.googleapis.com/zimulate/check-user.json";

const storage = new Storage();

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

const processVoices = (data) => {
  if (!data?.voices) return {};

  const filtered = data.voices
    .filter((v) => v.labels?.language === "en")
    .map((v) => ({
      voice_id: v.voice_id,
      labels: v.labels,
    }));

  const structure = {};
  filtered.forEach((v) => {
    const { gender, accent, age } = v.labels;

    if (!structure[gender]) structure[gender] = {};
    if (!structure[gender][accent]) structure[gender][accent] = {};
    if (!structure[gender][accent][age]) structure[gender][accent][age] = [];

    structure[gender][accent][age].push(v.voice_id);
  });

  return structure;
};

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

app.post("/duplicateAgent", async (req, res) => {
  const {
    originalAgentId = "agent_7601k24j14jtfv6s6m3r46bcafxq",
    testName,
    email,
    attemptNo,
    persona,
    personality,
    testLogID,
  } = req.body;

  if (!testName || !email || !attemptNo || !persona || !personality) {
    return res.status(400).json({ error: "Missing required parameters." });
  }

  const newName = `Agent_${testName}_${email}_${attemptNo}_${persona}`;
  const payload = { name: newName };

  try {
    await logParameters({
      testLogID,
      step: "Starting duplication",
      side: "Server",
      data: { payload },
    });

    const duplicateRes = await fetch(
      `${ELEVEN_LABS_BASE_URL}/agents/${originalAgentId}/duplicate`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVEN_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const duplicateText = await duplicateRes.text();

    await logParameters({
      testLogID,
      step: "Agent Duplicated",
      side: "Server",
      duplicate_agent_response: duplicateText,
    });

    if (!duplicateRes.ok) {
      throw new Error(
        `Duplication failed: ${duplicateRes.status} - ${duplicateText}`
      );
    }

    const duplicatedAgent = JSON.parse(duplicateText);
    const newAgentId = duplicatedAgent.agent_id;

    const updatePayload = {
      conversation_config: {
        agent: { initiates_conversation: true },
        tts: { voice_id: personality.voiceId },
      },
    };

    const updateRes = await fetch(
      `${ELEVEN_LABS_BASE_URL}/agents/${newAgentId}`,
      {
        method: "PATCH",
        headers: {
          "xi-api-key": ELEVEN_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updatePayload),
      }
    );

    const updateText = await updateRes.text();

    await logParameters({
      testLogID,
      step: "Agent Updated",
      side: "Server",
      updated_agent_response: updateText,
    });

    if (!updateRes.ok) {
      throw new Error(`Update failed: ${updateRes.status} - ${updateText}`);
    }

    const updatedAgent = JSON.parse(updateText);

    await logParameters({
      testLogID,
      step: "Success",
      side: "Server",
      data: { newAgentId: updatedAgent.agent_id },
    });

    res.status(200).json({
      message: "Agent duplicated and updated successfully",
      agent_id: updatedAgent.agent_id,
      details: updatedAgent,
    });
  } catch (error) {
    console.error("❌ ElevenLabs Error:", error);
    await logParameters({
      testLogID,
      step: "Error duplicating/updating ConvAI agent",
      side: "Server",
      error: error.message,
    });
    res.status(500).json({
      error: "Failed to duplicate or update agent",
      details: error.message,
    });
  }
});

app.get("/getvoices", async (req, res) => {
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": ELEVEN_API_KEY,
      },
    });

    if (!response.ok) {
      return res
        .status(response.status)
        .json({ error: "Failed to fetch voices from 11Labs" });
    }

    const data = await response.json();
    const processed = processVoices(data);

    res.json(processed);
  } catch (error) {
    console.error("Error fetching voices:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/check-user", async (req, res) => {
  try {
    const data = req.body;
    logParameters({
      testLogID,
      step: "check-user called",
      side: "Server",
      data: data,
    });

    if (!data.firstName || !data.lastName || !data.email) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const response = await fetch(PUBLIC_JSON_URL);
    if (!response.ok) {
      logParameters({
        testLogID,
        step: "check-user json fetch failed",
        side: "Server",
        url: PUBLIC_JSON_URL,
      });
      throw new Error("Failed to fetch users.json from bucket");
    }

    const authenticatedUsers = await response.json();

    const match = authenticatedUsers.some(
      (user) =>
        user.firstName === data.firstName &&
        user.lastName === data.lastName &&
        user.email === data.email
    );

    if (match) {
      logParameters({
        testLogID,
        step: "check-user success",
        side: "Server",
        data: data,
      });
      return res.status(200).send("ok");
    } else {
      logParameters({
        testLogID,
        step: "check-user failed - user not found",
        side: "Server",
        data: data,
      });
      throw new Error("User not found");
    }
  } catch (err) {
    logParameters({
      testLogID,
      step: "check-user failed - error occurred",
      side: "Server",
      err: err.message,
    });
    console.error("Error:", err.message);
    res.status(400).json({ error: err.message });
  }
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
