const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const app = express();
require('dotenv').config();

const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// --- CORS Setup ---
const corsOptions = {
  origin: [
    'http://localhost:5173',
    'https://home-repairs-57fcc.web.app',
    'https://home-repairs-57fcc.firebaseapp.com',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

const logger = (req, res, next) => {
  console.log(`Request received: ${req.method} ${req.originalUrl}`);
  next();
};

const verifyToken = (req, res, next) => {
  const token = req?.cookies?.token;
  if (!token) return res.status(401).send({ message: 'Unauthorized access' });

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) return res.status(401).send({ message: 'Unauthorized access' });
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.8kzkr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const servicesCollection = client.db('homeRepairs').collection('services');
    const serviceApplicationCollection = client
      .db('homeRepairs')
      .collection('service_applications');

    // Get services with search, sort, pagination
    app.get('/services', logger, async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6;
        const skip = (page - 1) * limit;
        const sortQuery = req.query.sort; // expecting "true" or "false"
        const search = req.query.search || '';

        // Build query for search
        const query = {};
        if (search.trim() !== '') {
          query.$or = [
            { serviceName: { $regex: search, $options: 'i' } },
            { serviceArea: { $regex: search, $options: 'i' } },
          ];
        }

        // Build sort option
        let sortOption = {};
        if (sortQuery === 'true') {
          sortOption = { price: 1 }; // low to high
        } else if (sortQuery === 'false') {
          // maybe do no sorting or default sorting,
          // or descending if you want: { price: -1 }
          sortOption = {};
        }

        const services = await servicesCollection
          .find(query)
          .sort(sortOption)
          .skip(skip)
          .limit(limit)
          .toArray();

        res.json(services);
      } catch (error) {
        console.error('Error in GET /services:', error);
        res.status(500).send({ error: 'Internal Server Error' });
      }
    });

    // Get count for services (filtered by search)
    app.get('/services-count', async (req, res) => {
      try {
        const search = req.query.search || '';

        const query = {};
        if (search.trim() !== '') {
          query.$or = [
            { serviceName: { $regex: search, $options: 'i' } },
            { serviceArea: { $regex: search, $options: 'i' } },
          ];
        }

        const count = await servicesCollection.countDocuments(query);
        res.json({ count });
      } catch (err) {
        console.error('Error in GET /services-count:', err);
        res.status(500).send({ error: 'Internal Server Error' });
      }
    });

    // rest of your routes unchanged...

    // Example: Get service by ID
    app.get('/services/:id', async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id))
        return res.status(400).send({ message: 'Invalid ID format' });

      const result = await servicesCollection.findOne({
        _id: new ObjectId(id),
      });
      res.json(result);
    });

    // TODO: other routes like service applications etc.
  } catch (err) {
    console.error('Error connecting to MongoDB:', err);
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Service is running');
});

app.listen(port, () => {
  console.log(`Server running on port: ${port}`);
});
