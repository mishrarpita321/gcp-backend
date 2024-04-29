const express = require('express');
const multer = require('multer');

const app = express();
const PORT = 3000;

const fs = require('fs');
const fsExtra = require('fs-extra');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
const sharp = require('sharp');
const cloudinary = require('cloudinary').v2;
const path = require('path');

const outputFolder = 'output_faces_with_emotions'; // Specify the output folder


// Initialize myJSONArray
let myJSONArray = {
    timeTaken: "",
    joyful: [],
    anger: [],
    sorrow: [],
    surprise: []
  }
          
cloudinary.config({ 
  cloud_name: 'dnyrzsuyu', 
  api_key: '825733616217131', 
  api_secret: 'ITxnchtMr2rdpovEpNMBmQjgOTE' 
});


function emptyFolder(folderPath) {
    fs.readdir(folderPath, (err, files) => {
        if (err) throw err;

        for (const file of files) {
            fs.unlink(path.join(folderPath, file), err => {
                if (err) throw err;
            });
        }
    });
}


async function clearFolderInCloudinary(folderPath) {
    try {
        // List all resources (images) in the specified folder
        const resources = await cloudinary.api.resources({
            type: 'upload',
            prefix: folderPath,
            max_results: 500 // Adjust based on your needs
        });

        // Delete each resource (image) in the folder
        for (const resource of resources.resources) {
            await cloudinary.uploader.destroy(resource.public_id);
            // console.log(`Deleted resource: ${resource.public_id}`);
        }

        // console.log(`All resources in folder '${folderPath}' deleted successfully.`);
    } catch (error) {
        console.error('Error clearing folder in Cloudinary:', error);
        throw error;
    }
}




async function clearAndDetectAndSaveFacesWithEmotions(imagePath, outputFolder) {
    // Record start time
    clearFolderInCloudinary(outputFolder);
    const startTime = process.hrtime();
    try {
        // Clear the content of the output folder
        fsExtra.emptyDirSync(outputFolder);

        // Create a Google Cloud Vision client
        const client = new ImageAnnotatorClient({ keyFilename: 'jsonFilePath.json' });

        // Read the image file
        console.log(imagePath);
        const imageBuffer = fs.readFileSync(`uploads/${imagePath.filename}`);

        // Detect faces in the image
        const [result] = await client.faceDetection(imageBuffer);
        const faces = result.faceAnnotations;

        // Create folders for each emotion if they don't exist
        const emotions = ['surprise', 'anger', 'sorrow', 'joyful'];
        emotions.forEach(emotion => {
            const emotionFolder = `${outputFolder}/${emotion}`;
            if (!fs.existsSync(emotionFolder)) {
                fs.mkdirSync(emotionFolder, { recursive: true });
            }
        });

        // Save each detected face with its emotions into the respective emotion folder
        for (let i = 0; i < faces.length; i++) {
            const face = faces[i];
            const vertices = face.boundingPoly.vertices;

            // Extract the coordinates of the bounding box
            const minX = Math.min(vertices[0].x, vertices[1].x, vertices[2].x, vertices[3].x);
            const minY = Math.min(vertices[0].y, vertices[1].y, vertices[2].y, vertices[3].y);
            const width = Math.abs(vertices[1].x - vertices[0].x);
            const height = Math.abs(vertices[2].y - vertices[1].y);

            // Extract the face region from the image
            const faceImageBuffer = await sharp(imageBuffer)
                .extract({ left: minX, top: minY, width, height })
                .toBuffer();

            // Determine the dominant emotion for the face
            const dominantEmotion = determineDominantEmotion(face);

            // Upload the face image with emotions to Cloudinary
            await uploadImageToCloudinary(faceImageBuffer, dominantEmotion);
        }

        // console.log('All faces detected and saved with emotions successfully.');
        // Record end time
    const endTime = process.hrtime(startTime);
    const elapsedTimeInSeconds = endTime[0] + endTime[1] / 1e9;
    myJSONArray.timeTaken = elapsedTimeInSeconds.toFixed(2);
        // console.log(JSON.stringify(myJSONArray, null, 2));
    emptyFolder('uploads');

        return JSON.stringify(myJSONArray, null, 2);
    } catch (error) {
        console.error('Error:', error);
    }
}



async function uploadImageToCloudinary(faceImageBuffer, dominantEmotion) {
    try {
        // Convert the image buffer to a base64-encoded string
        const base64Image = faceImageBuffer.toString('base64');

        const result = await cloudinary.uploader.upload(`data:image/jpeg;base64,${base64Image}`, {
            folder: `${outputFolder}/${dominantEmotion}`
        });

    // Push the URL to the appropriate array in myJSONArray
    switch (dominantEmotion) {
        case 'joyful':
          myJSONArray.joyful.push(result.secure_url);
          break;
        case 'angry':
          myJSONArray.anger.push(result.secure_url);
          break;
        case 'sad':
          myJSONArray.sorrow.push(result.secure_url);
          break;
        case 'surprise':
          myJSONArray.surprise.push(result.secure_url);
          break;
      }
        

        // console.log(`Uploaded face image with emotions to Cloudinary. Public URL: ${result.secure_url}`);
    } catch (error) {
        console.error('Error uploading image to Cloudinary:', error);
        throw error;
    }
}


// Function to determine the dominant emotion for a face
function determineDominantEmotion(face) {
    // Determine the dominant emotion based on likelihood scores
    if (face.joyLikelihood === 'VERY_LIKELY' || face.joyLikelihood === 'LIKELY'|| face.joyLikelihood === 'POSSIBLE') {
        return 'joyful';
    } else if (face.sorrowLikelihood === 'VERY_LIKELY' || face.sorrowLikelihood === 'LIKELY'|| face.sorrowLikelihood === 'POSSIBLE') {
        return 'sad';
    } else if (face.angerLikelihood === 'VERY_LIKELY' || face.angerLikelihood === 'LIKELY'|| face.angerLikelihood === 'POSSIBLE') {
        return 'angry';
    } else if (face.surpriseLikelihood === 'VERY_LIKELY' || face.surpriseLikelihood === 'LIKELY'|| face.surpriseLikelihood === 'POSSIBLE') {
        return 'surprise';
    }
}




// Multer storage configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/') // Uploads will be stored in the 'uploads/' directory
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname) // Add a timestamp to the file name to make it unique
  }
});

const upload = multer({ storage: storage });

// Route to handle file upload
app.post('/upload', upload.single('image'), (req, res) => {
  // The uploaded file will be available in req.file
  if (!req.file) {
    return res.status(400).send('No files were uploaded.');
  }

//const imagePath = 'emotions2.jpeg'; // Replace 'input.jpg' with the path to your image file
myJSONArray = {
    timeTaken: "",
    joyful: [],
    anger: [],
    sorrow: [],
    surprise: []
  }
clearAndDetectAndSaveFacesWithEmotions(req.file, outputFolder).then((result) => {
    return res.status(200).send(result);
})

  // Send a success response
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
