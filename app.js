require('dotenv').config();
const express = require('express');
const axios = require('axios');
const session = require('express-session');
const errors = [];

const PORT = 3000;

const BASE_API_URL = "https://o.applovin.com/mediation/v1/";

const app = express();
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/assets', express.static('views/assets'));

app.use(session({
    secret: 'your_secret_key_here',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 60000 }
}));

app.set('view engine', 'ejs');

app.get('/', (req, res) => {
    res.render('index', { 
        generated_ad_units: req.session.generated_ad_units || [],
        errors: req.session.errors || []
    });
});

app.post('/', async (req, res) => {
    const errors = [];  
    const { name, package_name, platform, apiToken, developerUsername } = req.body;

    const API_HEADERS = {
        'Api-Key': apiToken,
        'Content-Type': 'application/json'
    };

    const generated_ad_units = [];

    for (let ad_format of ['INTER', 'BANNER', 'APPOPEN']) {
        const payload = {
            name: name + ' ' + ad_format,
            platform,
            package_name,
            ad_format
        };

        try {
            const response = await axios.post(BASE_API_URL + "ad_unit", payload, { headers: API_HEADERS });
            generated_ad_units.push(response.data);
        } catch (error) {
            const errorMessage = error.response && error.response.data ? JSON.stringify(error.response.data) : error.message;
            errors.push(`Failed to create ${ad_format} ad unit: ${errorMessage}`);
        }
    }

    try {
        const response = await axios.post("https://onesignal.com/api/v1/apps", { name }, {
            headers: {
                "Authorization": `Basic ${process.env.ONESIGNAL_AUTH_KEY}`,
                "Content-Type": "application/json"
            }
        });
        generated_ad_units.push({ one_signal_id: response.data.id });
    } catch (error) {
        const errorMessage = error.response && error.response.data ? JSON.stringify(error.response.data) : error.message;
        errors.push("Failed to create app in OneSignal: " + errorMessage);
    }

    if (developerUsername !== 'none') {
        try {
            // Create a private repo
            const githubResponse = await axios.post(
                'https://api.github.com/user/repos',
                {
                    name: name, // using the app's name
                    private: true,
                },
                {
                    headers: {
                        Authorization: `token ${process.env.GITHUB_TOKEN}`,
                    },
                }
            );
    
            // Add developer as a collaborator
            await axios.put(
                `https://api.github.com/repos/${process.env.GITHUB_USERNAME}/${name}/collaborators/${developerUsername}`,
                {},
                {
                    headers: {
                        Authorization: `token ${process.env.GITHUB_TOKEN}`,
                    },
                }
            );
    
            // Optionally store the repository URL
            generated_ad_units.push({ github_repo_url: githubResponse.data.clone_url });
    
        } catch (error) {
            const errorMessage = error.response && error.response.data ? JSON.stringify(error.response.data) : error.message;
            errors.push("Failed to create and/or share GitHub repo: " + errorMessage);
        }
    }

    req.session.generated_ad_units = generated_ad_units;
    req.session.errors = errors;
    res.redirect('/');
});

app.get('/get_ad_units', async (req, res) => {
    const api_token = req.query.apiToken;

    try {
        const response = await axios.get(BASE_API_URL + "ad_units/", { headers: { 'Api-Key': api_token, 'Content-Type': 'application/json' } });
        res.json(response.data);
    } catch (error) {
        res.json({ "error": "Failed to retrieve ad units" });
    }
});

app.get('/download_xml', (req, res) => {
    const generated_ad_units = req.session.generated_ad_units || [];
    let xml_content = "<resources>\n";

    xml_content += '    <string name="applovin_sdk_key">gvcyZqhgCmHnI7I-DHWLXoVhQkrqbHzcltIZAATT0RH-cWpBip16xde9wnuZq-I0CTLsqKAoe6z7U_6TdF12bx</string>\n';
    xml_content += '    <string name="apps_flyer_key">2czkX4PzkQ6nw2iaf3y8zJ</string>\n';
    
    

    for (let ad_unit of generated_ad_units) {
        if (ad_unit.ad_format) {
            xml_content += `    <string name="applovin_${ad_unit.ad_format.toLowerCase()}">${ad_unit.id}</string>\n`;
        }

        if (ad_unit.one_signal_id) {
            xml_content += `    <string name="one_signal_id">${ad_unit.one_signal_id}</string>\n`;
        }

        if(ad_unit.github_repo_url){
            xml_content += `    <!-- ${ad_unit.github_repo_url} -->\n`;
        }
    }

    xml_content += "</resources>";
    res.set('Content-Type', 'application/xml');
    res.set('Content-Disposition', 'attachment; filename=ad_config.xml');
    res.send(xml_content);
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});