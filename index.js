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

const bucketName = 'zimulate';

app.post('/uploadChunks', upload.any(), async (req, res) => {
  try {
    const audioOverlayMeta = JSON.parse(req.body.audioOverlays || '[]');
    const tempFilePath = `tmp-${Date.now()}.webm`;

    // 1. Combine Chunks into a Single File
    const chunkFiles = req.files.filter(f => f.fieldname.startsWith('chunk-'))
      .sort((a, b) => a.originalname.localeCompare(b.originalname));
    const writeStream = fs.createWriteStream(tempFilePath);
    for (const file of chunkFiles) {
      writeStream.write(fs.readFileSync(file.path));
      fs.unlinkSync(file.path);
    }
    writeStream.end();

    writeStream.on('finish', async () => {
      const mergedPath = `final-${Date.now()}.webm`;

      // 2. Download Audio Overlay Files from GCS
      const overlayPaths = await Promise.all(audioOverlayMeta.map(async (overlay, idx) => {
        const tempAudio = `audio_${idx}_${Date.now()}.mp3`;
        const destPath = path.join(__dirname, tempAudio);
        await storage.bucket(bucketName).file(`GoogleFunctions/Audios/${overlay.file}`).download({ destination: destPath });
        return { ...overlay, localPath: destPath };
      }));

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

      res.status(200).send('Video uploaded with audio overlays');
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Processing error');
  }
});

async function overlayMultipleAudios(videoPath, overlays, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpegCmd = ffmpeg(videoPath);

    // Add overlay inputs
    overlays.forEach(({ localPath }) => {
      ffmpegCmd.input(localPath);
    });

    // Construct complex filter
    let filter = '';
    const inputs = ['[0:a]']; // Original audio

    overlays.forEach((overlay, i) => {
      const label = `[a${i + 1}]`;
      const delay = overlay.start * 1000;
      filter += `[${i + 1}:a]adelay=${delay}|${delay}${label};`;
      inputs.push(label);
    });

    filter += `${inputs.join('')}amix=inputs=${inputs.length}:duration=first:dropout_transition=2[aout]`;

    ffmpegCmd
      .complexFilter(filter, ['aout'])
      .outputOptions('-map', '0:v', '-map', '[aout]')
      .on('end', resolve)
      .on('error', reject)
      .save(outputPath);
  });
}

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
