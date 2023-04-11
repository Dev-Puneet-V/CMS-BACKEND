require('dotenv').config();
const bodyParser = require('body-parser');
const express = require('express');
const app = express();
const { v4: uuidv4 } = require('uuid');
const AWS = require('aws-sdk');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
AWS.config.update({
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY
});
const s3 = new AWS.S3();
const dynamoDB = new AWS.DynamoDB({ region: process.env.AWS_REGION })
const port = process.env.PORT || 3000;
app.use(cors({
    origin: "*"
}))
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Set up Multer middleware to handle file uploads
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
      cb(null, 'uploads/')
    },
    filename: function(req, file, cb) {
      cb(null, Date.now() + path.extname(file.originalname));
    }
  });


const upload = multer({
    storage: storage,
    fileSize: 1024 * 1024 * 6, // Maximum file size of 6 MB
    files: 6, // Maximum of 6 files
    fileFilter: function(req, file, cb) {
        cb(null, true);
    }
});

app.post('/products', upload.array('productImages', 6), async (req, res, next) => {
    try{
        if (!req.files || req.files.length < 1) {
            throw new Error('At least one image is required', 400);
        }
        const { name, description, price, currency } = req.body;
         // Generate a UUID for the product
        const productId = uuidv4();
        // Upload the files to S3
        const filePromises = req.files.map(file => {
            const params = {
            Bucket: 'cms-assi',
            Key: `${productId}/${file.originalname}`,
            Body: fs.readFileSync(file.path),
            ContentType: file.mimetype
            };
            return s3.upload(params).promise();
        });
        // Wait for all of the file uploads to complete
        const fileResults = await Promise.all(filePromises);

        // Construct the DynamoDB item for the product
        const productItem = {
            "productId": { "S": productId },
            "name": { "S": name },
            "description": { "S": description },
            "price": { "N": price.toString() },
            "currency": { "S": currency },
            "images": { "L": fileResults.map(result => ({ "S": result.Location })) }
          };

        // Store the product item in DynamoDB
        await dynamoDB.putItem({
            TableName: 'products',
            Item: productItem
        }).promise();
        res.status(200).json({
            success: true,
            message: 'Product uploaded successfully'
        });
    } catch(err){
        next(err);
    }
});


app.get('/products',  async (req, res, next) => {
    try{
        const params = {
            TableName: 'products',
          };
        const data = await dynamoDB.scan(params).promise();
        const products = data.Items.map(item => ({
            productId: item.productId.S,
            name: item.name.S,
            description: item.description.S,
            price: item.price.N,
            currency: item.currency.S,
            image: item.images.L[0].S // Get the first image URL
        }));
        console.log(products)
        res.status(200).json({
            success: true,
            products
        });
    } catch(err){
        next(err);
    }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
