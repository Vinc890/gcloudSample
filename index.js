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
const upload = multer({ dest: "uploads/" });
const { spawn } = require("child_process");
const fs = require("fs");

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

// app.post("/overlay-audio", async (req, res) => {
//   try {
//     const bucketName = "zimulate";
//     const folder = "GoogleFunctions";
//     const videoFileName = "v1.webm";
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

const bucketName = "zimulate";

app.post("/uploadChunks", upload.any(), async (req, res) => {
  try {
    const audioOverlayMeta = JSON.parse(req.body.audioOverlays || "[]");
    const tempFilePath = `tmp-${Date.now()}.webm`;

    // 1. Combine Chunks into a Single File
    const chunkFiles = req.files
      .filter((f) => f.fieldname.startsWith("chunk-"))
      .sort((a, b) => a.originalname.localeCompare(b.originalname));
    const writeStream = fs.createWriteStream(tempFilePath);
    for (const file of chunkFiles) {
      writeStream.write(fs.readFileSync(file.path));
      fs.unlinkSync(file.path);
    }
    writeStream.end();

    writeStream.on("finish", async () => {
      const mergedPath = `final-${Date.now()}.webm`;

      // 2. Download Audio Overlay Files from GCS
      const overlayPaths = await Promise.all(
        audioOverlayMeta.map(async (overlay, idx) => {
          const tempAudio = `audio_${idx}_${Date.now()}.mp3`;
          const destPath = path.join(__dirname, tempAudio);
          await storage
            .bucket(bucketName)
            .file(`GoogleFunctions/Audios/${overlay.file}`)
            .download({ destination: destPath });
          return { ...overlay, localPath: destPath };
        })
      );

      // 3. Overlay Audios
      await overlayMultipleAudios(tempFilePath, overlayPaths, mergedPath);

      // 4. Upload Final Video
      await storage.bucket(bucketName).upload(mergedPath, {
        destination: `GoogleFunctions/Videos/${path.basename(mergedPath)}`,
        resumable: false,
      });

      // 5. Cleanup
      fs.unlinkSync(tempFilePath);
      fs.unlinkSync(mergedPath);
      overlayPaths.forEach(({ localPath }) => fs.unlinkSync(localPath));

      res.status(200).send("Video uploaded with audio overlays");
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Processing error");
  }
});

function overlayMultipleAudios(videoPath, overlays, outputPath) {
  return new Promise((resolve, reject) => {
    const args = ["-y"]; // Overwrite output

    // 0: Input video
    args.push("-i", videoPath);

    // 1-N: Input audio overlays
    overlays.forEach((o) => {
      args.push("-i", o.localPath);
    });

    // Build filter_complex
    const filterParts = [];
    const audioLabels = ["[0:a]"];

    overlays.forEach((o, idx) => {
      const delay = o.start * 1000;
      const label = `[a${idx + 1}]`;
      // Apply delay using adelay
      filterParts.push(`[${idx + 1}:a]adelay=${delay}|${delay}${label}`);
      audioLabels.push(label);
    });

    // Mix all audio streams
    const mixInputs = audioLabels.join("");
    filterParts.push(
      `${mixInputs}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=2[aout]`
    );

    args.push("-filter_complex", filterParts.join(";"));
    args.push("-map", "0:v"); // keep video stream
    args.push("-map", "[aout]"); // final mixed audio
    args.push("-c:v", "copy"); // copy video codec
    args.push(outputPath);

    const ffmpeg = spawn("ffmpeg", args);

    ffmpeg.stderr.on("data", (data) => {
      console.log(`stderr: ${data}`);
    });

    ffmpeg.on("error", (error) => {
      console.error(`FFmpeg error: ${error.message}`);
      reject(error);
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        console.log("FFmpeg finished successfully");
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });
  });
}

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
