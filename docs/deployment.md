# Deployment Guide

## Deploying the GEE App

### Prerequisites
- A [Google Earth Engine](https://earthengine.google.com/) account
- Access to the `washways` GEE project (for private assets)

### Steps

1. **Open the GEE Code Editor**: Navigate to [code.earthengine.google.com](https://code.earthengine.google.com/)

2. **Create a new script**: Click *New* → *File* in the Scripts panel

3. **Paste the code**: Copy the contents of `gee/groundwater_discovery_portal.js` into the editor

4. **Verify asset access**: Ensure you have access to:
   - `projects/washways/assets/BDTICMM250m` (Depth to Bedrock)
   - `projects/washways/assets/AridityIndexv31yrFixed` (Aridity Index)
   - If using your own assets, update the asset paths in the `DATA` section

5. **Test in Code Editor**: Click **Run** to test the app interactively

6. **Publish as GEE App**:
   - Click the **Apps** button (top-right of Code Editor)
   - Click **New App**
   - Configure:
     - **App Name**: `groundwaterdiscoveryportal`
     - **Project**: `washways` (or your project)
     - **Source Code**: Select the script
     - **Access**: Who can view the app (Anyone / Anyone with Google account)
   - Click **Publish**
   - The app URL will be: `https://<project>.projects.earthengine.app/view/<appname>`

7. **Update the app**: To push code changes, edit the script and click **Manage Apps** → **Update** on the existing app

---

## Deploying the Landing Page at washways.org

### Option A: Subdirectory on Existing Site

If washways.org is hosted on a standard web server (Apache, Nginx, Cloudflare Pages, etc.):

1. Create a directory `groundwaterdiscoveryportal/` in your web root
2. Upload the contents of the `site/` folder into that directory
3. The page will be accessible at `https://washways.org/groundwaterdiscoveryportal/`

### Option B: Cloudflare Pages (if using Cloudflare)

1. Push this repository to GitHub
2. In Cloudflare Dashboard → Pages → Create a project
3. Connect your GitHub repository
4. Set **Build output directory** to `site/`
5. Set **Root directory** to `/`
6. Deploy — configure the custom domain `washways.org/groundwaterdiscoveryportal`

### Option C: GitHub Pages

1. Push this repository to GitHub
2. Go to Settings → Pages
3. Set source to "Deploy from a branch" → `main` → `/site`
4. Configure your DNS to point `washways.org` to GitHub Pages, or use a subdomain

---

## Embedding vs. Redirect

The landing page (`site/index.html`) uses an **iframe embed** to display the GEE app directly within the washways.org page. This provides a seamless user experience.

**If the iframe doesn't load** (some browsers or GEE configurations may block embedding):
- The page includes a fallback "Open App" button that links directly to the GEE app URL
- You can switch to a pure redirect by replacing the iframe section with a `<meta http-equiv="refresh">` tag

### Testing the Embed

GEE Apps generally allow iframe embedding. Test by:
1. Opening `site/index.html` locally in a browser
2. Checking if the GEE app loads within the iframe
3. If blocked, the fallback link will be shown automatically
