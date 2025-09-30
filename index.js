const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// CORS setup
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
  console.log(`Received ${req.method} ${req.originalUrl}`);
  next();
};

const verifyToken = (req, res, next) => {
  const token = req?.cookies?.token;
  if (!token) {
    return res.status(401).send({ message: 'Unauthorized access' });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: 'Unauthorized access' });
    }
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

    // --- Services with search, sort, pagination ---
    app.get('/services', logger, async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6;
        const skip = (page - 1) * limit;
        const sortQuery = req.query.sort; // expects “true” or “false”
        const search = req.query.search || '';

        const query = {};
        if (search.trim() !== '') {
          query.$or = [
            { serviceName: { $regex: search, $options: 'i' } },
            { serviceArea: { $regex: search, $options: 'i' } },
          ];
        }

        let sortOption = {};
        if (sortQuery === 'true') {
          sortOption = { price: 1 };
        }

        const services = await servicesCollection
          .find(query)
          .sort(sortOption)
          .skip(skip)
          .limit(limit)
          .toArray();

        res.json(services);
      } catch (err) {
        console.error('Error in GET /services:', err);
        res.status(500).send({ error: 'Internal Server Error' });
      }
    });

    // --- Count endpoint for filtered services ---
    app.get('/services-count', logger, async (req, res) => {
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

    // --- Get service by ID ---
    app.get('/services/:id', logger, async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'Invalid ID' });
      }
      const result = await servicesCollection.findOne({
        _id: new ObjectId(id),
      });
      res.json(result);
    });

    // Add this route in your server.js:
    app.post('/jwt', logger, (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '1h',
      });
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        })
        .send({ success: true });
    });

    // --- Create new service ---
    app.post('/services', logger, async (req, res) => {
      const newService = req.body;
      newService.createdAt = new Date().toISOString();
      newService.applicationCount = 0;
      const result = await servicesCollection.insertOne(newService);
      if (result.insertedId) {
        res.status(201).json({ serviceId: result.insertedId });
      } else {
        res.status(400).json({ error: 'Service creation failed' });
      }
    });

    // --- Get applications for a given service (public) ---
    app.get(
      '/service-application/services/:service_id',
      logger,
      async (req, res) => {
        const serviceId = req.params.service_id;
        const query = { service_id: serviceId };
        const applications = await serviceApplicationCollection
          .find(query)
          .toArray();
        res.json(applications);
      }
    );

    // --- Get applications by applicant email (protected) ---
    app.get('/service-application', logger, verifyToken, async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ message: 'Email query missing' });
      }
      if (req.user?.email !== email) {
        return res.status(403).send({ message: 'Forbidden access' });
      }

      const applications = await serviceApplicationCollection
        .find({ applicant_email: email })
        .toArray();

      // Enrich each with service data
      const result = await Promise.all(
        applications.map(async (app) => {
          let serviceData = null;
          if (ObjectId.isValid(app.service_id)) {
            serviceData = await servicesCollection.findOne({
              _id: new ObjectId(app.service_id),
            });
          }
          if (serviceData) {
            app.serviceName = serviceData.serviceName;
            app.providerImage = serviceData.providerImage;
            app.serviceArea = serviceData.serviceArea;
            app.providerName = serviceData.providerName;
            app.price = serviceData.price;
            app.createdAt = serviceData.createdAt;
          }
          return app;
        })
      );

      res.json(result);
    });

    // --- Get applications for services provided by the user ---
    app.get(
      '/service-application/provider',
      logger,
      verifyToken,
      async (req, res) => {
        const email = req.query.email;

        if (!email) {
          return res.status(400).send({ message: 'Email query missing' });
        }

        if (req.user?.email !== email) {
          return res.status(403).send({ message: 'Forbidden access' });
        }

        // Step 1: Find all services created by this provider
        const services = await servicesCollection
          .find({ providerEmail: email })
          .toArray();

        const serviceIds = services.map((s) => s._id.toString());

        // Step 2: Find all applications for those services
        const applications = await serviceApplicationCollection
          .find({ service_id: { $in: serviceIds } })
          .toArray();

        // Step 3: Enrich applications with their respective service details
        const enriched = applications.map((app) => {
          const service = services.find(
            (s) => s._id.toString() === app.service_id
          );
          if (service) {
            app.serviceName = service.serviceName;
            app.price = service.price;
            app.location = service.serviceArea;
            app.createdAt = app.createdAt || service.createdAt;
          }
          return app;
        });

        res.json(enriched);
      }
    );

    // --- PATCH: Update application status ---
    app.patch(
      '/service-application/:id',
      logger,
      verifyToken,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: 'Invalid application ID' });
        }

        if (!status || !['Pending', 'Working', 'Complete'].includes(status)) {
          return res.status(400).send({ message: 'Invalid status value' });
        }

        const result = await serviceApplicationCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        if (result.modifiedCount > 0) {
          res.json({ success: true });
        } else {
          res
            .status(404)
            .json({ error: 'Application not found or status unchanged' });
        }
      }
    );

    // --- Delete an application by its _id ---
    app.delete(
      '/service-application/:id',
      logger,
      verifyToken,
      async (req, res) => {
        const id = req.params.id;
        console.log('Attempting to delete:', id);

        if (!ObjectId.isValid(id)) {
          console.log('Invalid ObjectId');
          return res.status(400).send({ message: 'Invalid application ID' });
        }

        const found = await serviceApplicationCollection.findOne({
          _id: new ObjectId(id),
        });
        console.log('Found application:', found);

        const result = await serviceApplicationCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount > 0) {
          res.json({ success: true });
        } else {
          res.status(404).json({ error: 'Application not found' });
        }
      }
    );

    // --- Update service (if needed) ---
    app.put('/services/:id', logger, async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'Invalid service ID' });
      }
      const updateFields = req.body; // assume only allowed fields passed
      const result = await servicesCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateFields }
      );
      if (result.modifiedCount > 0) {
        res.json({ success: true });
      } else {
        res.status(404).send({ message: 'Service not found or no change' });
      }
    });

    // --- Delete a service ---
    app.delete('/services/:id', logger, async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ error: 'Invalid service ID' });
      }
      const result = await servicesCollection.deleteOne({
        _id: new ObjectId(id),
      });
      if (result.deletedCount > 0) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Service not found' });
      }
    });
  } catch (err) {
    console.error('Error in run():', err);
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Service is running');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
