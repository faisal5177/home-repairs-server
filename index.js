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

// --- Middleware ---
const logger = (req, res, next) => {
  console.log(`inside the logger`);
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

// --- MongoDB Setup ---
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

    // --- Auth APIs ---
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '5h',
      });

      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
        })
        .send({ success: true });
    });

    app.post('/logout', (req, res) => {
      res
        .clearCookie('token', {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
        })
        .send({ success: true, message: 'Logged out successfully' });
    });

    // --- Get all services ---
    app.get('/services', logger, async (req, res) => {
  try {
    const providerEmail = req.query.providerEmail;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 4;
    const skip = (page - 1) * limit;
    const sortByPrice = req.query.sort === 'true'; // Check for sort query

    let query = {};
    if (providerEmail) {
      query = {
        providerEmail,
        applicationCount: { $gt: 0 },
      };
    }

    const sortOptions = sortByPrice ? { price: 1 } : {}; // ASC by price

    const result = await servicesCollection
      .find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({ error: 'Internal Server Error' });
  }
});

    // --- Get service by ID ---
    app.get('/services/:id', async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id))
        return res.status(400).send({ message: 'Invalid ID format' });

      const result = await servicesCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // --- Get total service count ---
    app.get('/services-count', async (req, res) => {
      try {
        const count = await servicesCollection.estimatedDocumentCount();
        res.send({ count });
      } catch (err) {
        res.status(500).send({ error: 'Internal Server Error' });
      }
    });

    // --- Create a new service ---
    app.post('/services', async (req, res) => {
      const newService = req.body;
      newService.createdAt = new Date().toISOString();
      newService.applicationCount = 0;

      const result = await servicesCollection.insertOne(newService);
      result.insertedId
        ? res.status(201).json({ serviceId: result.insertedId })
        : res.status(400).json({ error: 'Service creation failed' });
    });

    // --- Get applications for a specific service ---
    app.get('/service-application/services/:service_id', async (req, res) => {
      const serviceId = req.params.service_id;
      const query = { service_id: serviceId };
      const applications = await serviceApplicationCollection
        .find(query)
        .toArray();
      res.send(applications);
    });

    // --- Get applications by applicant email (protected) ---
    app.get('/service-application', verifyToken, async (req, res) => {
      const email = req.query.email;
      if (!email)
        return res.status(400).send({ message: 'Email query missing' });
      if (req.user?.email !== email)
        return res.status(403).send({ message: 'Forbidden access' });

      const result = await serviceApplicationCollection
        .find({ applicant_email: email })
        .toArray();

      for (const application of result) {
        let service = null;
        if (ObjectId.isValid(application.service_id)) {
          service = await servicesCollection.findOne({
            _id: new ObjectId(application.service_id),
          });
        }

        if (service) {
          Object.assign(application, {
            serviceName: service.serviceName,
            providerImage: service.providerImage,
            serviceArea: service.serviceArea,
            providerName: service.providerName,
            price: service.price,
            createdAt: service.createdAt,
          });
        }
      }

      res.send(result);
    });

    // --- Create a new application & update count ---
    app.post('/service-applications', async (req, res) => {
      const application = req.body;
      application.createdAt = new Date().toISOString();
      application.status = 'Pending';

      const result = await serviceApplicationCollection.insertOne(application);

      const id = application.service_id;
      if (ObjectId.isValid(id)) {
        await servicesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $inc: { applicationCount: 1 } }
        );
      }

      res.send(result);
    });

    // --- Update application status ---
    app.patch('/service-application/:id', async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'Invalid application ID' });
      }

      const result = await serviceApplicationCollection.updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            status,
            updatedAt: new Date(),
          },
        }
      );

      result.modifiedCount > 0
        ? res.send({ message: 'Application status updated successfully' })
        : res
            .status(404)
            .send({ message: 'Application not found or unchanged' });
    });

    // --- Delete application ---
    app.delete('/service-application/:id', async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id))
        return res.status(400).send({ message: 'Invalid ID' });

      const result = await serviceApplicationCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // --- Update service details ---
    app.put('/services/:id', async (req, res) => {
      const { id } = req.params;
      const { serviceArea, applicationDate } = req.body;

      if (!ObjectId.isValid(id))
        return res.status(400).send('Invalid service ID');

      const updateFields = {};
      if (typeof serviceArea === 'string')
        updateFields.serviceArea = serviceArea;
      if (typeof applicationDate === 'string')
        updateFields.applicationDate = applicationDate;

      try {
        const result = await servicesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields }
        );

        result.modifiedCount === 0
          ? res.status(404).send('Service not found or no change made.')
          : res.send({
              success: true,
              message: 'Service updated successfully',
            });
      } catch (error) {
        console.error('Error updating service:', error);
        res.status(500).send('Internal server error');
      }
    });

    // --- Delete service ---
    app.delete('/services/:id', async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id))
        return res.status(400).json({ error: 'Invalid service ID' });

      const result = await servicesCollection.deleteOne({
        _id: new ObjectId(id),
      });

      result.deletedCount > 0
        ? res.send({ message: 'Service deleted successfully' })
        : res.status(404).json({ error: 'Service not found' });
    });
  } finally {
    // Connection remains open
  }
}

// --- Start Server ---
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Service is falling from the sky');
});

app.listen(port, () => {
  console.log(`Server running on port: ${port}`);
});
