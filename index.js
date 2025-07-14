require("dotenv").config();
const express = require("express");
const app = express();
const PORT = 3000;
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { Storage } = require("@google-cloud/storage");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const multer = require("multer");
// const upload = multer({ dest: "tmp/" });
const storage = new Storage();
// const ffmpeg = require("fluent-ffmpeg");
// const upload = multer({ dest: "uploads/" });

app.get("/", (req, res) => {
  const ffmpeg = spawn("/usr/bin/ffmpeg", ["--help"]);

  ffmpeg.stdout.on("data", (data) => {
    console.log(`stdout: ${data}`);
  });

  ffmpeg.stderr.on("data", (data) => {
    console.error(`stderr: ${data}`);
  });

  ffmpeg.on("close", (code) => {
    console.log(`FFmpeg exited with code ${code}`);
    callback(code === 0 ? null : new Error("Conversion failed"));
  });

  res.send("Hello World");
});

app.post("/overlay-audio", async (req, res) => {
  try {
    const bucketName = "zimulate";
    const folder = "GoogleFunctions";
    const videoFileName = "vv1.webm";
    const audioFiles = [
      { name: "tt1.mp3", delay: 20 },
      { name: "tt2.mp3", delay: 30 },
      { name: "tt3.mp3", delay: 30 },
    ];

    const localDir = path.join(__dirname, "tmp");
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir);

    const downloadFile = async (fileName) => {
      const localPath = path.join(localDir, fileName);
      const file = storage.bucket(bucketName).file(`${folder}/${fileName}`);
      await file.download({ destination: localPath });
      return localPath;
    };

    // Download video and audio files
    const videoPath = await downloadFile(videoFileName);
    const audioPaths = await Promise.all(
      audioFiles.map((f) => downloadFile(f.name))
    );

    // Construct ffmpeg input arguments
    const ffmpegInputs = [`-i "${videoPath}"`];
    const filterParts = [];
    const mixInputs = [];

    audioPaths.forEach((audioPath, index) => {
      ffmpegInputs.push(`-i "${audioPath}"`);
      const delay = audioFiles[index].delay * 1000;
      const label = `a${index}`;
      filterParts.push(`[${index + 1}:a]adelay=${delay}|${delay}[${label}]`);
      mixInputs.push(`[${label}]`);
    });

    filterParts.push(
      `${mixInputs.join("")}amix=inputs=${audioPaths.length}[mixed]`
    );
    filterParts.push(`[0:a][mixed]amix=inputs=2[aout]`);

    const outputFileName = `output_${Date.now()}.webm`;
    const outputPath = path.join(localDir, outputFileName);

    const ffmpegCommand = [
      ...ffmpegInputs,
      `-filter_complex "${filterParts.join(";")}"`,
      `-map 0:v -map "[aout]" -c:v copy -c:a libvorbis `,
      `"${outputPath}"`,
    ].join(" ");

    console.log(" Running ffmpeg...");

    await execPromise(`/usr/bin/ffmpeg ${ffmpegCommand}`);

    const destinationPath = `${folder}/${outputFileName}`;
    await storage.bucket(bucketName).upload(outputPath, {
      destination: destinationPath,
      contentType: "video/mp4",
    });

    console.log(`✅ Uploaded to GCS: ${destinationPath}`);
    res.json({ outputUrl: `gs://${bucketName}/${destinationPath}` });

    // Cleanup
    [videoPath, ...audioPaths, outputPath].forEach((filePath) => {
      fs.unlinkSync(filePath);
    });
  } catch (err) {
    console.error("❌ Error in /overlay-audio:", err);
    res.status(500).send(`Overlay failed.${err}`);
  }
});

// app.post("/upload-video-chunks", express.json({ limit: "500mb" }), async (req, res) => {
//   try {
//     const { chunks } = req.body; 
//     if (!Array.isArray(chunks) || chunks.length === 0) {
//       return res.status(400).json({ error: "No video chunks provided." });
//     }

//     const bucketName = "zimulate";
//     const folder = "GoogleFunctions";
//     const fileName = "vv1.webm";
//     const localDir = path.join(__dirname, "tmp");

//     if (!fs.existsSync(localDir)) fs.mkdirSync(localDir);

//     const localPath = path.join(localDir, fileName);
//     const writeStream = fs.createWriteStream(localPath);

//     for (const base64Chunk of chunks) {
//       const buffer = Buffer.from(base64Chunk, "base64");
//       writeStream.write(buffer);
//     }

//     writeStream.end();

//     writeStream.on("finish", async () => {
//       try {
//         const destinationPath = `${folder}/${fileName}`;
//         await storage.bucket(bucketName).upload(localPath, {
//           destination: destinationPath,
//           contentType: "video/webm",
//         });

//         console.log(`✅ Uploaded vv1.webm to GCS: ${destinationPath}`);
//         fs.unlinkSync(localPath);
//         res.json({ message: "Video uploaded successfully.", path: destinationPath });
//       } catch (uploadErr) {
//         console.error("❌ Error uploading to GCS:", uploadErr);
//         res.status(500).send("Upload failed.");
//       }
//     });

//     writeStream.on("error", (err) => {
//       console.error("❌ Write stream error:", err);
//       res.status(500).send("Error writing video file.");
//     });

//   } catch (err) {
//     console.error("❌ Error in /upload-video-chunks:", err);
//     res.status(500).send("Upload failed.");
//   }
// });

const upload = multer({ storage: multer.memoryStorage() });

app.post("/uploadChunks", upload.any(), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).send("No chunks received");
    }

 
    const sortedChunks = files
      .filter(f => f.fieldname.startsWith("chunk-"))
      .sort((a, b) => {
        const aIndex = parseInt(a.fieldname.split("-")[1]);
        const bIndex = parseInt(b.fieldname.split("-")[1]);
        return aIndex - bIndex;
      });

    const localDir = path.join(__dirname, "tmp");
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir);

    const outputPath = path.join(localDir, "vv1.webm");
    const writeStream = fs.createWriteStream(outputPath);

    for (const chunk of sortedChunks) {
      writeStream.write(chunk.buffer);
    }

    writeStream.end();

    writeStream.on("finish", async () => {
      try {
        const bucketName = "zimulate";
        const folder = "GoogleFunctions";
        const destinationPath = `${folder}/vv1.webm`;

        await storage.bucket(bucketName).upload(outputPath, {
          destination: destinationPath,
          contentType: "video/webm",
        });

        fs.unlinkSync(outputPath);

        console.log(`✅ Uploaded vv1.webm to GCS`);
        res.status(200).json({ message: "Upload complete", path: destinationPath });
      } catch (err) {
        console.error("❌ GCS Upload failed:", err);
        res.status(500).send("Upload to GCS failed");
      }
    });

    writeStream.on("error", (err) => {
      console.error("❌ File write error:", err);
      res.status(500).send("Failed to write video");
    });
  } catch (err) {
    console.error("❌ Error in /uploadChunks:", err);
    res.status(500).send("Unexpected server error");
  }
});

// const upload = multer({ storage: multer.memoryStorage() });

app.post("/upload-and-overlay", upload.any(), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).send("No chunks received");
    }

    // Sort and reassemble chunks
    const sortedChunks = files
      .filter(f => f.fieldname.startsWith("chunk-"))
      .sort((a, b) => {
        const aIndex = parseInt(a.fieldname.split("-")[1]);
        const bIndex = parseInt(b.fieldname.split("-")[1]);
        return aIndex - bIndex;
      });

    const localDir = path.join(__dirname, "tmp");
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir);

    const tempInputPath = path.join(localDir, "vv1.webm");
    const writeStream = fs.createWriteStream(tempInputPath);

    for (const chunk of sortedChunks) {
      writeStream.write(chunk.buffer);
    }
    writeStream.end();

    writeStream.on("finish", async () => {
      try {
        const bucketName = "zimulate";
        const folder = "GoogleFunctions";
        const inputFileName = "vv1.webm";
        const inputGCSPath = `${folder}/${inputFileName}`;

        // Upload raw video to GCS
        await storage.bucket(bucketName).upload(tempInputPath, {
          destination: inputGCSPath,
          contentType: "video/webm",
        });

        console.log(`✅ Uploaded ${inputFileName} to GCS`);

        // Now: overlay audio on the uploaded video
        const audioFiles = [
          { name: "tt1.mp3", delay: 20 },
          { name: "tt2.mp3", delay: 30 },
          { name: "tt3.mp3", delay: 30 },
        ];

        const downloadFile = async (fileName) => {
          const localPath = path.join(localDir, fileName);
          const file = storage.bucket(bucketName).file(`${folder}/${fileName}`);
          await file.download({ destination: localPath });
          return localPath;
        };

        const videoPath = await downloadFile(inputFileName);
        const audioPaths = await Promise.all(
          audioFiles.map((f) => downloadFile(f.name))
        );

        // FFMPEG setup
        const ffmpegInputs = [`-i "${videoPath}"`];
        const filterParts = [];
        const mixInputs = [];

        audioPaths.forEach((audioPath, index) => {
          ffmpegInputs.push(`-i "${audioPath}"`);
          const delay = audioFiles[index].delay * 1000;
          const label = `a${index}`;
          filterParts.push(`[${index + 1}:a]adelay=${delay}|${delay}[${label}]`);
          mixInputs.push(`[${label}]`);
        });

        filterParts.push(`${mixInputs.join("")}amix=inputs=${audioPaths.length}[mixed]`);
        filterParts.push(`[0:a][mixed]amix=inputs=2[aout]`);

        const outputFileName = `output_${Date.now()}.webm`;
        const outputPath = path.join(localDir, outputFileName);

        const ffmpegCommand = [
          ...ffmpegInputs,
          `-filter_complex "${filterParts.join(";")}"`,
          `-map 0:v -map "[aout]" -c:v copy -c:a libvorbis `,
          `"${outputPath}"`,
        ].join(" ");

        console.log("▶️ Running ffmpeg...");
        await execPromise(`/usr/bin/ffmpeg ${ffmpegCommand}`);

        const outputGCSPath = `${folder}/${outputFileName}`;
        await storage.bucket(bucketName).upload(outputPath, {
          destination: outputGCSPath,
          contentType: "video/webm",
        });

        console.log(`✅ Final video uploaded: ${outputGCSPath}`);

        // Cleanup
        [tempInputPath, videoPath, ...audioPaths, outputPath].forEach((filePath) => {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        });

        res.status(200).json({
          message: "Upload and overlay complete",
          videoUrl: `gs://${bucketName}/${outputGCSPath}`,
        });

      } catch (err) {
        console.error("❌ Processing failed:", err);
        res.status(500).send("Audio overlay or GCS upload failed.");
      }
    });

    writeStream.on("error", (err) => {
      console.error("❌ Chunk file write error:", err);
      res.status(500).send("Failed to write video file.");
    });

  } catch (err) {
    console.error("❌ Unexpected error in /upload-and-overlay:", err);
    res.status(500).send("Server error");
  }
});


app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
