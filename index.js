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
const upload = multer({ dest: "tmp/" });

const storage = new Storage();

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

app.post("/overlay-audio", upload.array("videos"), async (req, res) => {
  try {
    const bucketName = "zimulate";
    const folder = "GoogleFunctions";
    const audioFiles = [
      { name: "tt1.mp3", delay: 20 },
      { name: "tt2.mp3", delay: 30 },
      { name: "tt3.mp3", delay: 30 },
    ];

    const localDir = path.join(__dirname, "tmp");
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir);

    // Save uploaded video chunks
    const videoChunks = req.files.map((file) => file.path);

    // Merge video chunks into one video using ffmpeg
    const concatListPath = path.join(localDir, "concat_list.txt");
    fs.writeFileSync(
      concatListPath,
      videoChunks.map((file) => `file '${path.resolve(file)}'`).join("\n")
    );

    const mergedVideoPath = path.join(localDir, `merged_${Date.now()}.webm`);
    await execPromise(
      `/usr/bin/ffmpeg -f concat -safe 0 -i "${concatListPath}" -c copy "${mergedVideoPath}"`
    );

    // Download audio files from GCS
    const downloadFile = async (fileName) => {
      const localPath = path.join(localDir, fileName);
      const file = storage.bucket(bucketName).file(`${folder}/${fileName}`);
      await file.download({ destination: localPath });
      return localPath;
    };

    const audioPaths = await Promise.all(audioFiles.map(f => downloadFile(f.name)));

    // Prepare ffmpeg audio overlay
    const ffmpegInputs = [`-i "${mergedVideoPath}"`];
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
      `-map 0:v -map "[aout]" -c:v copy -c:a libvorbis`,
      `"${outputPath}"`
    ].join(" ");

    console.log("🔧 Running ffmpeg to overlay audio...");
    await execPromise(`/usr/bin/ffmpeg ${ffmpegCommand}`);

    const destinationPath = `${folder}/${outputFileName}`;
    await storage.bucket(bucketName).upload(outputPath, {
      destination: destinationPath,
      contentType: "video/webm",
    });

    console.log(`✅ Uploaded to GCS: ${destinationPath}`);
    res.json({ outputUrl: `gs://${bucketName}/${destinationPath}` });

    // Cleanup
    [...videoChunks, ...audioPaths, mergedVideoPath, outputPath, concatListPath].forEach(filePath => {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });

  } catch (err) {
    console.error("❌ Error in /overlay-audio:", err);
    res.status(500).send(`Overlay failed. ${err}`);
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
