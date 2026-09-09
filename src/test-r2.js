import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand
} from "@aws-sdk/client-s3";

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME
} = process.env;

for (const [name, value] of Object.entries({
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME
})) {
  if (!value) {
    throw new Error(`${name} is not set`);
  }
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,

  // Cloudflare R2では不要なAWS標準の追加チェックサムを抑制
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",

  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY
  }
});

const key = "metadata/r2-test.json";

const testData = {
  status: "ok",
  message: "GitHub Actions -> Cloudflare R2 connection successful",
  createdAt: new Date().toISOString()
};

await client.send(
  new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: JSON.stringify(testData, null, 2),
    ContentType: "application/json"
  })
);

console.log(`WRITE OK: ${key}`);

const result = await client.send(
  new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key
  })
);

const body = await result.Body.transformToString();

console.log("READ OK");
console.log(body);
