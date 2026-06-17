# The Forge

<div align="center">
  <p><strong>A private, highly opinionated, self-hosted control center for your life.</strong></p>
  <p><em>"Do not make a bad day a bad week. Maintain the structure, stack small wins, and keep moving toward the version of you that can handle bigger responsibilities."</em></p>
</div>

---

## 🦅 The Philosophy

Most habit trackers are either too simple (checkboxes with no context) or too complex (bloated with features you don't need). **Life Control Center** was built from the ground up to solve a specific problem: bridging the gap between daily execution and long-term career/fitness goals. 

It acts as a ruthless, single-pane-of-glass dashboard for your non-negotiables. It enforces weekly reviews, tracks project output instead of just "busy work," and connects your daily studying to concrete career objectives.

## 🌟 Core Features

### 1. The Dashboard & Scoreboard
- **Weekly Scoreboard:** A real-time breakdown of your performance across Core Discipline, Training, Diet, Study, and Project execution.
- **Yearly Heatmap:** A responsive 52-week timeline. Maintain a 75% execution rate each week to keep your active streak alive (🔥). Clicking any week provides instant insights and pulls up your historical review notes.
- **Active Missions:** Set a primary target for the week so you never lose sight of the big picture.

### 2. Execution & Tracking
- **Daily Checklists:** Granular daily tracking (Monday-Sunday) that dynamically calculates your success rate.
- **Workout Progression:** A dedicated module for tracking daily workout plans, reps, weights, and notes. Ensures progressive overload is documented.
- **Diet & Protein:** Checkboxes to ensure dietary minimums (like protein goals and meal prep) are met.
- **Career & Certifications:** Log hours against specific certifications or technical skills. Watch the progress bar fill up against your weekly target.
- **Project Work:** Differentiates between core commitment hours and "bonus stretch" hours, tracking whether you produced valid output (code, documentation, workflows).

### 3. Dynamic & Editable
- **No Code Required:** Easily edit your Workout split, Scoreboard metrics, and Certification study plans directly through intuitive UI modals.
- **Dynamic System Goals:** Configure your baseline expectations (e.g., minimum workouts per week, minimum study hours) via the Settings interface. 

### 4. Review & Analytics
- **Weekly Review:** Built-in reflection inputs for logging "Wins", "Friction", and "Adaptations" so you iterate and improve every week.
- **Performance Reports:** Generate plain-text reports summarizing your execution over the past 4 weeks or the entire year, aggregating all your notes to identify trends.

## 🎨 Premium Aesthetics

The interface is built to wow. It utilizes a strict, custom **True Black Glassmorphism** design language.
- Ambient mesh gradients and radial glows.
- Smooth micro-animations, hover scaling, and deep box-shadows.
- A strict, actionable color palette: Green (Success), Purple (Streaks/Primary), Blue (Information), and Red (Fail States).

## 🛠️ Technology Stack

We rejected heavy frontend frameworks to ensure maximum performance and total control over the DOM.

- **Frontend:** Vanilla HTML5, CSS3, and JavaScript.
- **Backend:** Node.js & Express.
- **Database:** SQLite3. (All data is securely persisted on the backend to prevent accidental browser cache wipes).
- **Authentication:** Custom HTTP-only Cookie Auth.
- **Deployment:** Fully Dockerized.

## 🚀 Installation & Deployment

Life Control Center is designed to be hosted on your own infrastructure (Proxmox, Raspberry Pi, VPS).

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ycianno/life-control-center.git
   cd life-control-center
   ```

2. **Configure your Environment:**
   Edit the `docker-compose.yml` to set your application password (this secures the PWA from unauthorized access).
   ```yaml
   environment:
     - PORT=3007
     - APP_PASSWORD=YourSuperSecretPassword
   ```

3. **Deploy:**
   ```bash
   docker compose up -d
   ```

4. **Public Exposure (Optional but Recommended):**
   The application works flawlessly as a Progressive Web App (PWA) on iOS/Android. To access it outside your home network securely (without a VPN), we recommend using **Cloudflare Tunnels (Zero Trust)**.

## 💾 Backups
You can export your database directly from the UI using the **Export Backup** button, which generates a JSON file. For a raw database backup, securely copy the `database.sqlite` file out of the mounted `/data` volume.

## 📝 License
Created for Personal Use and Accountability.
