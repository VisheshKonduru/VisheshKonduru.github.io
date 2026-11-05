"""Project pages: titles, summaries and the write-up for each project, in reading order.

Each body is a list of blocks:
  h("Heading")                       section heading
  p("text")                          paragraph (HTML allowed)
  ul("item", "item", ...)            bullet list
  fig("path", "caption")             one image, full column width
  fig("path", "caption", "diagram")  diagram or chart on a white background
  pair(fig(...), fig(...))           two photos side by side, cropped to the same size
  trio(fig(...), fig(...), fig(...)) three photos side by side
  video("path", "caption")
  todo("what goes here")             placeholder until the photo exists

A project with a live demo sets demo=live(...); the page puts it under the spec list.
"""


def h(text):
    return f"<h2>{text}</h2>"


def h3(text):
    return f"<h3>{text}</h3>"


def p(text):
    return f"<p>{text}</p>"


def ul(*items):
    return "<ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


def fig(src, caption="", cls=""):
    cap = f"<figcaption>{caption}</figcaption>" if caption else ""
    return f'<figure class="fig {cls}"><img src="../{src}" alt="{caption}" loading="lazy">{cap}</figure>'


def video(src, caption=""):
    cap = f"<figcaption>{caption}</figcaption>" if caption else ""
    return f'<figure class="fig"><video src="../{src}" controls muted playsinline preload="metadata"></video>{cap}</figure>'


def loop(src, caption=""):
    cap = f"<figcaption>{caption}</figcaption>" if caption else ""
    return f'<figure class="fig"><video src="../{src}" autoplay muted loop playsinline preload="metadata"></video>{cap}</figure>'


def todo(text):
    return '<figure class="fig"><div class="todo">Coming soon</div></figure>'


IMPORTMAP = ('<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",'
             '"three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}</script>')


def live(inner, src, css=""):
    """Live demo block, placed under the project's spec list. The page's lazy loader imports
    `src` (relative to the project page) only when the block scrolls near, so only demos in
    view load. Every demo builds the shared layout from assets/3d/demo-shell.js (tabs, flow row,
    view, status, column of live plots). The demo folders' own index.html files are dev harnesses."""
    link = '<link rel="stylesheet" href="../assets/3d/demo-shell.css">' + (f'<link rel="stylesheet" href="../{css}">' if css else "")
    return (f'{link}{IMPORTMAP}<div class="live" id="live-demo" data-demo="../{src}">'
            f'<h2 class="live-head">Try it live</h2>'
            f'<div class="live-fig">{inner}</div></div>')


ARM_DEMO = live("<div data-arm3d></div>", "assets/3d/arm/arm-demo.js")
TB3_DEMO = live("<div data-tb3></div>", "assets/3d/turtlebot/embed.js")
MQP_DEMO = live("<div data-mqpvis></div>", "assets/3d/mqp/perception.js")
UR5E_DEMO = live("<div data-ur5e3d></div>", "assets/3d/ur5e/ur5e-demo.js", css="assets/3d/ur5e/ur5e.css")


KATEX = ('<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">'
         '<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>'
         '<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js" '
         'onload="renderMathInElement(document.querySelector(&#39;.article&#39;),{delimiters:[{left:&#39;$$&#39;,right:&#39;$$&#39;,display:true},{left:&#39;\\\\(&#39;,right:&#39;\\\\)&#39;,display:false}]})"></script>')


def pair(a, b):
    return f'<div class="pair">{a}{b}</div>'


def trio(a, b, c):
    return f'<div class="trio">{a}{b}{c}</div>'


PROJECTS = [
    dict(
        slug="heimdall",
        title="Heimdall: An Agentic Eye for Chemistry",
        short="Heimdall",
        thumb="assets/img/heimdall/inputs.jpg",
        meta="Software engineer at Cavall Labs (CMU VentureBridge), March 2026 to now.",
        honors=["Co-first author", "Accepted to the NeurIPS 2026 ML4Molecules workshop"],
        blurb="A multi-agent system that reads molecule drawings in papers and patents and turns them into SMILES.",
        tags=["Agentic systems", "Tool-using agents", "Agent skills", "MCP", "Claude Code", "Codex", "Python", "RDKit", "FastAPI", "TypeScript", "Next.js", "Docker"],
        body=[
            p("Chemistry papers and patents show molecules as drawings. Before a chemist can search them, compare them or run them through other software, someone has to turn each drawing back into a structure a computer can read, usually a SMILES string. Doing that by hand is slow, and the tools that try to do it automatically struggle with the drawings that actually show up in documents."),
            fig("assets/img/heimdall/inputs.jpg", "The same molecule drawn the ways it shows up in real documents: low-resolution scans with page markings, abbreviations, stereochemistry, colour and hand-drawn styles, and generic structures with placeholder groups.", "diagram"),
            h("How it works"),
            p("Heimdall splits the job between language models and ordinary code. A director agent looks at each image and decides whether to read it whole, split it into regions, or set it aside. Reader agents describe what they see piece by piece through a command-line tool, instead of writing SMILES themselves. A deterministic RDKit back end assembles those pieces, joins the regions back together and checks that the result is a valid molecule. When something doesn't add up, separate agents are asked about chemical or visual uncertainty, and a final pass rereads any gaps in stereochemistry."),
            p("The point of that split is that the language model never produces the final answer on its own. Every structure that comes out has been built and checked by RDKit."),
            fig("assets/img/heimdall/pipeline.jpg", "The image-to-SMILES pipeline. Red boxes are language model agents, blue boxes are deterministic code.", "diagram wide"),
            p("Patents need more than reading single drawings. A separate pipeline works through a whole patent PDF: it finds the regions worth reading, reads chemical names and drawings, checks whether the patent claims a generic Markush structure, and if it does, builds the scaffold and its R-group definitions. It uses the image-to-SMILES pipeline for every drawing it finds."),
            fig("assets/img/heimdall/patent_pipeline.jpg", "The patent extraction pipeline, from setup through names, drawings, the Markush genus build and the final report.", "diagram"),
            h("Benchmark"),
            p("We tested Heimdall on a benchmark split into three tiers: clean baseline images, degraded ones, and frontier cases like metal complexes, images from the wild and hand-drawn structures, plus secondary sets and two full patents."),
            fig("assets/img/heimdall/benchmark.jpg", "The benchmark sets and how many images are in each.", "diagram wide"),
            h("What else I built around it"),
            ul(
                "An agent role system. One central config sets each role's model, effort level and tool permissions, and compiles them into the native agent files for Claude Code, Codex, Cursor, Zed and OpenCode.",
                "A server-side runtime in a FastAPI back end that runs Heimdall's skills and MCP tools on each user's own API key, and routes requests between local and cloud models.",
                "A document interface in Next.js and TypeScript where chemists cut molecule drawings out of PDFs and images, send them through Heimdall, then review and export the results.",
                "Docker images for the FastAPI and PostgreSQL back end, with the PyTorch vision model moved into its own service to keep the API image small.",
            ),
            h("What I'm working on now"),
            p("A molecule sketcher that runs in the browser, written in TypeScript with RDKit compiled to WebAssembly. It turns raw pen strokes into bonds, rings, stereo wedges and handwritten element labels, and shows the SMILES live as you draw."),
        ],
        links=[("Paper on OpenReview", "https://openreview.net/forum?id=QrZdMrLP5X"),
               ("NeurIPS 2026", "https://neurips.cc/Conferences/2026"),
               ("Heimdall on GitHub", "https://github.com/CAVALL-ORG/Heimdall"),
               ("Cavall", "https://www.cavall.ai/")],
    ),
    dict(
        slug="mqp",
        title="Autonomous Robotic Design for Strategic Adversarial Games",
        short="Autonomous Robotic Design for Strategic Adversarial Games",
        thumb="assets/img/mqp/robot.jpg",
        meta="Major Qualifying Project at WPI, 2025 to 2026. Team of seven, advised by Griffin Tabor, Bradley Miller and Xinming Huang.",
        blurb="A robot that plays the 2025-26 VEX game, Push Back, with no driver. It sees the field with five cameras and two LiDARs, plans with ROS 2, and picks its moves with a strategy agent trained by self-play.",
        tags=["Mechanical design", "Design under constraints", "Onshape", "SolidWorks", "Python", "C++", "ROS 2", "Nav2", "BehaviorTree.CPP", "RViz", "Gazebo", "Jetson", "OpenCV", "YOLO", "PyTorch", "Blender", "PPO"],
        demo=MQP_DEMO,
        body=[
            p("More than 10,000 high school teams play VEX every year, all with robots driven by people. Our goal was to build one that plays the same game against a human using only what it can sense and compute on board. That means it has to see the field, know where it is, track the other robot and decide what to do next, all in real time."),
            p("The game was Push Back: a 12 by 12 foot field with 88 blocks in two colours, scored into tube-shaped goals at different heights. VEX U rules allowed this robot a 15 inch cube at the start, and only VEX's own motors."),
            fig("assets/img/mqp/robot.jpg", "The robot on the Push Back field."),

            h("The robot"),
            p("The base is an X-drive: four omni wheels at 45 degrees, so the robot can move in any direction without turning first. A column of rubber-band rollers pulls blocks in, carries them up and scores them at three heights. A colour sensor in the intake spots the other team's blocks and throws them out halfway up the column. The first hopper design was an open basket, and it jammed. We replaced it with a single-file magazine that holds 10 blocks and stopped jamming."),
            p("I designed and built the whole robot. The hard part was fitting everything inside that 15 inch cube: five cameras, two SICK LiDARs, two Jetsons, the batteries, an IMU and the colour sensor, with the intake and scoring column running through the middle five inches and every sensor still getting a clear view of the field."),
            loop("assets/3d/mqp/mqp_turntable.mp4", "The robot's CAD, rendered in Blender Cycles."),
            pair(fig("assets/img/mqp/render_front.jpg", "Render of the CAD from the front."),
                 fig("assets/img/mqp/render_side.jpg", "Render of the CAD from the side.")),
            pair(fig("assets/img/mqp/cad.jpg", "CAD cross-section: intake, scoring paths and camera mount."),
                 fig("assets/img/mqp/system.jpg", "How the sensors, Jetsons and VEX controller connect.")),

            h("Electronics"),
            p("The main computer is a Jetson AGX Orin. The LiDARs connect over Ethernet, and everything else goes through a custom Comms Board that talks to the VEX V5 Brain over RS-485, sending velocities for seven motors at 100 Hz and reading encoder data back. A separate Power Board, rated for 200 W, has a fuel gauge to track the battery. The team wrote ROS 2 drivers for the IMU and the fuel gauge, and fixed bugs in the colour sensor driver."),
            fig("assets/img/mqp/power.jpg", "Power Board layout."),

            h("Getting around the field"),
            p("Navigation runs on ROS 2. AMCL fuses the two LiDARs, the IMU and wheel odometry to keep track of where the robot is. Nav2's MPPI controller plans and follows paths. Higher-level moves, like picking up a block while driving, are written as behaviour trees in BehaviorTree.CPP. To pick up a block, a small controller centres the nearest detection in the front camera and drives into it."),
            loop("assets/video/mqp_rviz.mp4", "The robot localizing and moving around the field, shown in RViz."),
            p("We tested in Gazebo before the real field. With about 70 blocks on the field the simulation slowed to 3.4% of real time, so we simplified the meshes, turned the blocks into spheres and raised the time step. Gazebo can't simulate rolling friction, so we wrote a plugin for it."),
            pair(fig("assets/img/mqp/bt.jpg", "Behaviour tree for picking up blocks while driving."),
                 fig("assets/img/mqp/gazebo.jpg", "The Push Back field in Gazebo.")),
            loop("assets/video/mqp_nav.mp4", "Planning and following a path: Gazebo on the left, RViz on the right."),
            loop("assets/video/mqp_gazebo.mp4", "The robot driving in the Gazebo simulation."),

            h("Seeing the field"),
            p("Getting four cameras into the Orin took several tries. A depth camera had too narrow a view, four USB cameras overloaded the Orin's shared USB controller, and a four-camera board needed a connector the Orin doesn't have. In the end a Jetson Nano reads all four cameras, corrects the lighting, stitches the frames into one 2560 by 400 image and streams it to the Orin over Ethernet."),
            p("Gym lighting is uneven, so before detection each frame goes through a Retinex-style correction in OpenCV: estimate the lighting from a blurred, shrunk copy of the image, divide it out, and bring the brightness to a fixed level. YOLOv11 then finds blocks at about 30 Hz. To turn a detection into a position on the field, each camera's image is projected onto the floor, and a small neural network trained per camera corrects what's left of the error."),
            fig("assets/img/mqp/retinex.jpg", "Lighting correction, step by step.", "diagram"),
            pair(fig("assets/img/mqp/detections.jpg", "YOLO detections from one of the robot's cameras."),
                 fig("assets/img/mqp/bev.jpg", "Detected blocks placed on a top-down map of the field.")),
            loop("assets/video/mqp_cameras.mp4", "YOLO detections on the real field, from the robot's cameras (2x speed)."),

            h("A model of the whole field"),
            p("We also trained one model that looks at all four cameras together and predicts what is in every part of the field, including blocks already in goals. The field is split into a 48 by 48 grid of 3 inch cells. A shared ResNet18 turns each camera image into features, and a Transformer lets each grid cell look at the parts of the camera images that could contain it."),
            p("We trained it on 200,000 synthetic images rendered in Blender from the field CAD, with 25 different lighting setups, generated on eight GPUs in 16 hours. Plain attention would not train, because almost every cell is empty. Deformable attention, which only looks near where each cell should appear in each camera, fixed it. A second version predicts the exact position of all 88 blocks, with a median error under 1.5 cm."),
            pair(fig("assets/img/mqp/render.jpg", "A synthetic training scene rendered in Blender."),
                 fig("assets/img/mqp/occupancy.jpg", "The model's predicted top-down map.")),

            h("Deciding what to do"),
            p("The strategy agent learned by playing against itself. We went through three versions. The first saw the field as a grid and trained with PPO, but 92,000 steps took a full day. The second added league play, where 20% of games are against older copies of itself, and rated every version with TrueSkill. The third moved to a faster continuous simulation in PyMunk, where the agent picks a target spot and heading every 200 milliseconds."),
            p("The final agent trained for eight days, over 26 million games, on 102 CPU cores and one GPU, and settled at a TrueSkill rating of about 160."),
            pair(fig("assets/img/mqp/selfplay.jpg", "The self-play simulator."),
                 fig("assets/img/mqp/trueskill.jpg", "TrueSkill rating over 26 million games of training.")),
            loop("assets/video/mqp_strategy.mp4", "Two copies of the strategy agent playing each other in the simulator (2x speed)."),

            h("What didn't work"),
            p("The report lists what didn't work. Every Comms Board we built burned out its RS-485 chips, probably because it had no protection diodes. We never had all the cameras connected to the main computer at once. The whole-field model runs at only 2 frames per second and has only seen synthetic data. The strategy agent was never run on the real robot. Those are the next steps for whoever picks this up."),
        ],
        links=[("Full report", "../docs/MQP_Report.pdf", "local"), ("Digital WPI", "https://digital.wpi.edu/concern/student_works/kw52jd66h?locale=en")],
    ),
    dict(
        slug="ultrasound",
        title="Custom Variable-Pitch Ultrasound Transducer Beamforming for Needle Guidance",
        short="Custom Variable-Pitch Ultrasound Transducer Beamforming for Needle Guidance",
        thumb="assets/img/ultrasound/probe.jpg",
        meta="RBE 544 graduate project at WPI, fall 2026.",
        honors=['Working with the WPI <a href="https://wp.wpi.edu/medicalfusionlab">Medical FUSION Lab</a>'],
        blurb="The JAR526 is a 128-element ultrasound probe with a slit through the middle for a needle, so its elements are not evenly spaced. We wrote a beamformer that uses where the elements really are, compared four ways of forming the image, and built a combined beamformer that makes the needle about four times easier to see.",
        tags=["MATLAB", "Verasonics", "Field II", "Signal processing"],
        body=[
            p("When a surgeon removes a kidney stone through the skin, they guide a needle into the kidney while watching it on ultrasound. With a normal probe the needle goes in next to the probe, and it is easy for it to drift out of the thin slice the probe can see."),
            p("The Japan Probe JAR526 fixes that with a 3 mm slit cut through the middle of its face, so the needle goes straight through the probe and stays in the image. The cost is that the 128 elements are no longer evenly spaced. There are 60 on each side, 0.15 mm apart, and eight smaller, oddly spaced ones tucked under the slit."),
            fig("assets/img/ultrasound/probe.jpg", "The JAR526 probe. The needle passes through the slit in the middle."),

            h("The problem"),
            p("An ultrasound image is built by beamforming. Every element fires at once, and for each pixel you work out how long the echo from that spot would take to reach each element, read each element's signal at that moment, and add them up. If something is really there, the readings line up and add to a bright spot. If not, they cancel out."),
            p("The math only works if you know where every element is. The code the lab had been using put all 128 elements on one even grid, as if the slit wasn't there, and switched off the eight under the slit. That puts each half of the probe 0.875 mm too close to the middle. That is about five times the error the timing can tolerate, so the two halves of the probe each see a target in a slightly different place, and one point shows up as two."),
            fig("assets/img/ultrasound/layout.jpg", "Top: the real element layout, with the eight slit elements in red. Bottom: the evenly spaced grid the old code assumed.", "diagram"),

            h("What I built"),
            p("A beamformer in MATLAB that takes a list of real element positions instead of assuming a grid, so the same code works for any layout. The slit elements' positions and sizes aren't given on the manufacturer's drawing, so we measured them from the scanned drawing."),
            p("On top of plain delay-and-sum (DAS), we implemented three methods from the research literature that weigh how well the elements agree with each other: the coherence factor (CF), delay-multiply-and-sum (DMAS) and short-lag spatial coherence (SLSC). SLSC normally assumes neighbouring element numbers are neighbouring positions, which isn't true here: elements 60 and 69 are next to each other in the list but 3.1 mm apart. So we computed spacing from the real positions instead."),
            p("We also reprogrammed the Verasonics research system with the measured positions, so its own live image uses the real geometry, and added switches to record with either layout and with the slit elements on or off."),

            h("Testing"),
            p("We tested everything first in Field II, a standard ultrasound simulator that models each element's real shape, then on the real system: a wire in a water tank, a wire with a needle through the slit, and a CIRS tissue phantom with wire and grey-scale targets."),
            p("With the real positions, small targets got about twice as sharp, in simulation and in the lab. A wire in the water tank went from 0.78 mm wide to 0.49 mm. On the phantom, a wire target went from 1.29 mm to 0.58 mm. The eight slit elements barely changed the image, which makes sense: they cover only 3 mm of the 21 mm probe."),
            fig("assets/img/ultrasound/wire.jpg", "The same wire reconstructed with the old positions and the real ones. With the old positions the peak is wide and shifted.", "diagram"),

            h("A combined beamformer for the needle"),
            p("None of the four methods was best at everything. CF showed the needle most clearly but broke the surrounding tissue up into dark patches. DAS kept the tissue looking right but showed the needle only faintly. So we built a combined beamformer that keeps the best of both."),
            p("A needle through the slit always shows up as a long vertical line, while tissue has no structure like that. The coherence factor stays high all the way along the needle, but in tissue it jumps around from pixel to pixel. So we average the coherence factor over a tall, narrow window, 2 mm deep and 0.3 mm wide, take its square root, and multiply the DAS image by it. Along the needle the average stays high, so the needle keeps its brightness. In tissue it settles to an almost constant value, so the background is dimmed evenly instead of broken up. We picked this form out of eleven combinations of DAS, CF and DMAS, scored against the same criteria."),
            ul("Needle contrast went from 4.7 to 18.8 in one scan and from 1.9 to 6.5 in another, compared with DAS on the same recordings.",
               "Compared with the old reconstruction, needle contrast went from 3.4 to 18.8.",
               "In the Field II simulation the needle stood 20.2 dB above the tissue, up from 13.0 dB.",
               "Tissue texture barely changed: speckle SNR went from 1.89 to 1.65, where CF alone dropped it to 0.70."),
            loop("assets/video/ultrasound_combined.mp4", "A needle going in through the slit. Left: DAS. Right: our combined beamformer, DAS multiplied by the square root of the windowed coherence factor."),
            fig("assets/img/ultrasound/lab_needle.jpg", "A real lab scan of a needle and a wire, reconstructed four ways from the same recording.", "diagram"),
            fig("assets/img/ultrasound/needle.jpg", "Simulated needle through the slit: old positions against real positions.", "diagram"),
            video("assets/video/ultrasound_needle.mp4", "The needle going in, old element positions against real positions."),
        ],
        links=[],
    ),
    dict(
        slug="iqp",
        title="Giving Shells a New Life: Oyster Waste Solutions in Angsila, Thailand",
        short="Giving Shells a New Life: Oyster Waste Solutions in Angsila, Thailand",
        thumb="assets/img/iqp/title.jpg",
        meta="Interactive Qualifying Project in Bangkok and Angsila, submitted March 2026. Sponsored by the Angsila Town Municipality and Chulalongkorn University's Department of Materials Science.",
        honors=["Nominated for WPI's President's IQP Award", "Nominated for the Forum on Education Abroad's Award for Academic Achievement Abroad"],
        blurb="Seven of us from WPI and Chulalongkorn University worked out how Angsila, a fishing town in Thailand, could turn the oyster shells piling up in its streets into building material.",
        tags=["Materials processing", "Materials testing", "Manufacturing", "Concrete composites", "Sustainability", "Circular economy", "Market analysis", "Stakeholder interviews", "Field research", "Thailand"],
        body=[
            fig("assets/img/iqp/title.jpg", "", "full"),

            h("Angsila and its oysters"),
            p("For generations, oyster farming has shaped Angsila's economy, culture and identity. The coastal town in Chonburi Province is Thailand's second-largest oyster-producing area, with about sixteen shucking houses. Many families depend on small-scale farming, shucking and selling seafood, and the work has been passed down from one generation to the next."),
            p("Many farms still use semi-traditional methods. Farmers grow oysters on nylon rope and concrete to raise their yields and stay competitive with larger industrial operations. Seasonal workers, many from Myanmar and Cambodia, help with farming and shucking."),
            pair(fig("assets/img/iqp/farm.jpg", "Oysters grown on ropes off the coast."),
                 fig("assets/img/iqp/boat.jpg", "Heading out to see the oyster farms.")),

            h("The problem"),
            p("The industry's growth has left the town with a waste problem. About 35 tonnes of shells come out of the shucking houses every week. With no collection or processing system, they get dumped in open piles next to businesses, roads, homes and the coastline. Many locals know the piles are a problem, but have no affordable alternative."),
            p("Leftover meat rots in the piles. It smells of ammonia and hydrogen sulfide, and draws flies and other pests. The nylon rope and concrete from farming are still attached, so they have to be separated before the shells can be cleaned and reused. That is also why an older market, selling whole shells as animal feed, fell apart."),
            p("Most places that reuse oyster shells, including in the United States, leave them to cure for 6 to 12 months first. Angsila doesn't have the open space to do that."),
            pair(fig("assets/img/iqp/pile_site.jpg", "One of the open shell piles in Angsila."),
                 fig("assets/img/iqp/pile_close.jpg", "Up close: meat, rope and plastic mixed in with the shells.")),

            h("Our goal"),
            p("We set out to design, with the people of Angsila, a cleaning and processing system that turns the shells into useful products, built around the town's needs and resources. By transforming shell waste into a viable resource, the project aims to preserve Angsila's oyster-farming culture and traditions while reducing the industry's burden on residents, workers and the surrounding environment."),
            p("That lines up with APEC's guidelines on reducing seafood waste, which name shell build-up as a problem and call for reusing it instead. We had three objectives:"),
            ul("Find the gaps in how shells are handled now, and what the town already has to work with.",
               "Develop a way to process shells into raw materials that can scale.",
               "Work out whether the products would sell, and how the system could grow."),

            h("Team and sponsors"),
            p("The project was sponsored by the Angsila Town Municipality and Chulalongkorn University's Department of Materials Science. Four of us from WPI joined three students from Chulalongkorn's Bachelor of Science in Applied Chemistry (BSAC) program in Bangkok, after a term of research methods and project preparation at WPI."),
            p("Between us we covered robotics, mechanical, aerospace, biomedical and computer engineering, professional writing, industrial and cosmetic chemistry, management and entrepreneurship. We worked with Chulalongkorn's Departments of Materials Science, Microbiology and Marketing: materials science for the lab tests, microbiology for the odor treatments, and marketing for the business analysis."),
            p("Our Thai teammates translated, helped us understand the cultural side of shell waste, approach shucking-house workers and officials respectfully, and anticipate how our ideas would be received. They also became our friends."),
            p("We were advised by Dr. Elizabeth Ryder and Dr. Douglas Creed at WPI, and by Prof. Dr. Patchanita Thamyongkit, Prof. Dr. Supawan Tantayanon and Dr. Numpon Insin at Chulalongkorn."),
            fig("assets/img/iqp/team_piles.jpg", "Our team at one of the piles."),

            h("Talking to the people involved"),
            p("We visited shucking houses and shell piles, and interviewed 24 shuckers, with our Chulalongkorn teammates translating. We also met town officials and the village head. Small shucking houses produce 2 to 3 tonnes of shells on a working day and large ones 4 to 5."),
            p("Odor was the most immediate concern for everyone we talked to. Getting rid of the shells is the shucking house owners' job, the town's landfills are almost full, and scattered dumping sites are hard to monitor. The village head said they would organise the community if there was a clear plan to follow."),
            pair(fig("assets/img/iqp/shucking_visit.jpg", "Visiting a shucking house."),
                 fig("assets/img/iqp/shucking_team.jpg", "Our team at another shucking house we visited.")),
            p("We mapped everyone involved: shuckers, farmers, the municipality, informal waste haulers, possible buyers, and how they connect. Then we drew the same map for how it could work."),
            pair(fig("assets/img/iqp/eco_now.jpg", "The system today.", "diagram"),
                 fig("assets/img/iqp/eco_future.jpg", "The system we proposed.", "diagram")),

            h("A process that can start small"),
            p("Being there changed how we saw the problem. We arrived thinking of the shells as material for new products. Seeing the size of the piles, and hearing from shuckers and residents, showed us that odor, space, contamination, cost and who is responsible decide whether any product matters at all. So we put cleaning and odor control first."),
            p("We staged the process using NASA's Technology Readiness Levels, so a single shucking house can start with simple tools and the town can grow toward a central plant. It works with the rope and concrete instead of asking farmers to change how they farm:"),
            ul("Collect shells at one central site chosen by the town.",
               "Crush them roughly to free the nylon rope.",
               "Sieve out the concrete, then stir the shells in water for an hour to wash off the meat.",
               "Dry them for three to five days.",
               "Grind them into powder of different coarseness.",
               "Sell the powder, or press it into coasters, tiles and pavers."),
            pair(fig("assets/img/iqp/rope.jpg", "Collecting shells for testing."),
                 fig("assets/img/iqp/crusher.jpg", "A jaw crusher like the one we recommended for small-scale processing.")),

            h("Making and testing the products"),
            p("We ran the whole process ourselves on shells from Angsila, in Chulalongkorn's labs. Then we made pavers, tiles and coasters with 0, 25, 50 and 75 percent of the mix replaced by ground shell. Coasters and tiles were pressed at 50 MPa in a hydraulic press and cured in air and water. Pavers were pressed in a steel mold."),
            pair(fig("assets/img/iqp/lab_work.jpg", "Mixing samples in the lab."),
                 fig("assets/img/iqp/press_mold.jpg", "Coaster mold in the hydraulic press.")),
            pair(fig("assets/img/iqp/paver_mold.jpg", "Pressing pavers in the steel mold."),
                 fig("assets/img/iqp/pavers.jpg", "Finished pavers.")),
            p("We tested five samples at each shell content in three-point bending. Strength fell steadily as shell went up: about 10.3 MPa with no shell, 7.8 at 25 percent, 6.0 at 50 percent and 2.8 at 75 percent. Water absorption rose with shell content, which means the material gets more porous. That suits uses like permeable pavers. Together the two results let you pick a shell ratio for the strength and drainage each product needs."),
            trio(fig("assets/img/iqp/specimens.jpg", "Test bars, labelled by percent shell."),
                 fig("assets/img/iqp/cubes.jpg", "Cube samples curing."),
                 fig("assets/img/iqp/prototypes.jpg", "Coasters and tiles at different shell contents.")),
            pair(fig("assets/img/iqp/strength.jpg", "Flexural strength against shell content.", "diagram"),
                 fig("assets/img/iqp/absorption.jpg", "Water absorption against shell content.", "diagram")),

            h("Dealing with the smell"),
            p("Because odor was the most urgent problem, we tested spray-on treatments that could help while a collection system is set up. Eight sealed tanks of shells were treated with combinations of calcium hydroxide, photosynthetic bacteria and effective microorganisms, with plain water as the control. After a week, 29 volunteers ranked them by smell without knowing which was which, and we measured each tank's pH to check for environmental side effects."),
            p("Some treatments did better on smell and others on pH. The biological treatments look promising, but need more controlled testing before anyone can be sure."),
            pair(fig("assets/img/iqp/odor_tanks.jpg", "The eight treatment tanks."),
                 fig("assets/img/iqp/ph_tank.jpg", "Measuring pH, tank by tank.")),

            h("Testing the coasters in real cafes"),
            p("We also wanted to know whether a product would hold up outside the lab. For about a week, two Power of Cups Cafe locations in Bangkok swapped their cork coasters for ours and used them in normal service with hot and cold drinks. Staff said they worked well and needed less washing than cork."),
            p("Posters in the cafes told customers about Angsila's shell problem and linked to a video about how the coasters are made, which got about 1,700 views that week. That suggests the same kind of display in Angsila's own cafes, restaurants and tourist spots could build interest in local shell products."),
            pair(fig("assets/img/iqp/cafe_poster.jpg", "The poster we put up in the cafes."),
                 fig("assets/img/iqp/poc_drinks.jpg", "Power of Cups drinks on our coasters.")),
            p('Thank you to <a href="https://www.instagram.com/bixtagon/">Bix Tagon Suwannavej</a>, owner of Power of Cups, for helping us run the trial.'),
            fig("assets/img/iqp/poc_owner.jpg", "With Bix Tagon Suwannavej at Power of Cups."),

            h("Business analysis"),
            p("Every market evaluation was done for Angsila specifically. We ran SWOT analyses, 4Ps analyses (product, price, place, promotion) and product positioning for each product. Pavers, tiles and agricultural feed would be sold business-to-business. Coasters and body scrubs would be sold to consumers, especially through tourism, where they can also tell Angsila's story."),
            p("We costed two products in detail. A 10 cm coaster that is 70 percent shell powder would cost about 15 baht to make and could sell for 25 to 50 baht. A paver that is 75 percent shell, made 500,000 a year, would earn about 2 to 4 baht each."),
            pair(fig("assets/img/iqp/swot_pavers.jpg", "SWOT analysis for shell pavers.", "diagram"),
                 fig("assets/img/iqp/positioning.jpg", "Where shell products sit against alternatives on price and eco-friendliness.", "diagram")),
            pair(fig("assets/img/iqp/coaster.jpg", "Size, weight and mix of our coaster.", "diagram"),
                 fig("assets/img/iqp/paver_dims.jpg", "Size, weight and mix of our paver.", "diagram")),
            p("The most flexible plan is to sell shell powder first, because it can go into construction, agriculture and consumer products, so the town doesn't depend on one market. We proposed a phased approach to our sponsor: improve collection and start small-scale processing, then use pilot production and market tests to decide when to invest in bigger equipment and more products."),
            pair(fig("assets/img/iqp/presenting.jpg", "Presenting our findings."),
                 fig("assets/img/iqp/team_booth.jpg", "Our team with the display and prototypes.")),

            h("What's next"),
            p("Seven weeks wasn't long enough to fully cure the pavers or to run the odor tests to a firm conclusion. A full system still needs a site, money, trained operators, regulatory approval and an organisation to run it. Two ideas we left for later: shell breakwaters and living shorelines, which use whole shells but are blocked by Thai law, and biosurfactants, which could clean shells well enough for higher-value cosmetic products."),
            p("The process itself isn't specific to Angsila. Any oyster-farming town could adapt it."),

            h("Recognition"),
            p('The project was nominated for <a href="https://www.wpi.edu/library/archives-special-collections/history/awards/presidents-iqp-awards">WPI\'s President\'s IQP Award</a> and for the Forum on Education Abroad\'s <a href="https://www.forumea.org/award-for-academic-achievement-abroad.html">Award for Academic Achievement Abroad</a>.'),
        ],
        links=[("Full report", "../docs/IQP_Report.pdf", "local"), ("Digital WPI", "https://digital.wpi.edu/concern/student_works/cz30px94x?locale=en")],
    ),
    dict(
        slug="rbe3001",
        title="4-DOF Robot Arm Kinematics and Vision-Based Object Sorting",
        short="4-DOF Robot Arm Kinematics and Vision-Based Object Sorting",
        thumb="assets/img/arm/thumb.jpg",
        meta="Course project at WPI, 2025. Team of four with Olivia Cavanagh, Graham Mack and Henry Sica.",
        blurb="A 4-joint robot arm with a camera that sorts coloured balls, follows a ball around in real time, and plays tic-tac-toe against a person.",
        tags=["MATLAB", "Kinematics", "Computer vision"],
        demo=ARM_DEMO,
        body=[
            loop("assets/video/arm_track.mp4", "The arm following a red ball in real time."),
            p("The final project for RBE 3001 brought together everything from the course's earlier labs: forward and inverse kinematics, velocity kinematics, camera calibration and image processing. The arm had to find balls of four colours on a checkerboard with its camera, pick each one up and sort it into the right bin."),
            p("On top of that we added two things of our own: real-time tracking, where the gripper follows a ball of one colour as someone moves it, and a game of tic-tac-toe against a person. I worked mostly on the tracking."),

            h("Kinematics"),
            p("We started from our code from the earlier labs, which moved the arm to a point or along a path using forward and inverse position kinematics. We set up a reference frame on each joint and wrote the Denavit-Hartenberg table from them. Velocity kinematics from lab 4 let the arm move balls quickly without dropping them."),
            fig("assets/img/arm/frames.jpg", "Reference frames on each joint, and the final transformation matrix.", "diagram"),

            h("Seeing the board"),
            p("The camera needed both calibrations. Intrinsic calibration, with MATLAB's camera calibration app, worked out the camera's focal length, optical centre and lens distortion from pictures of the checkerboard. Extrinsic calibration placed the camera relative to the board, so pointsToWorld() could turn a pixel into a position on the board."),
            fig("assets/img/arm/extrinsic.jpg", "Where the checkerboard was in each calibration image, relative to the camera.", "diagram"),
            p("Then we undistorted the image, blacked out everything outside the board, and used colour masks to pick out the red, orange, yellow and green balls. Each ball's centre became a target for the arm."),
            pair(fig("assets/img/arm/undistort.jpg", "Correcting the fish-eye distortion."),
                 fig("assets/img/arm/masked.jpg", "Masking out everything except the board.")),
            fig("assets/img/arm/labeled.jpg", "Balls found and labelled by colour."),

            h("Sorting"),
            p("The camera takes one reading of every ball and its position. The arm then goes above each ball, lowers, grabs it, lifts it back up and carries it to that colour's bin. Lifting straight up first keeps the gripper clear of the other balls. We used blocking moves so that new camera readings couldn't interrupt a move halfway through."),
            loop("assets/video/arm_sort.mp4", "Sorting balls into bins by colour (2x speed)."),

            h("Real-time tracking"),
            p("For tracking, the gripper follows one ball of a chosen colour around the board and ignores the others. At first it was slow and lagged well behind the ball. The masking code was inefficient, and plotting and print statements were slowing every frame down. Once we cut those and rewrote the masking, the arm kept up with the ball in real time."),

            h("Tic-tac-toe"),
            p("Our last task was a game against a person. The arm uses the same colour detection to read the board and a recursive search to pick its move. When nothing in view is moving, it checks whether the board has changed to know the person has played. It worked, though it sometimes placed a ball just off the board."),
            loop("assets/video/arm_tictactoe.mp4", "Playing tic-tac-toe (2x speed)."),
        ],
        links=[
            ("Report", "../docs/RBE3001_Report.pdf", "local"),
            ("Video", "https://www.youtube.com/watch?v=zCdq1DwnjjE"),
            ("Code", "https://github.com/RBE3001-C25/RBE3001_C25_Team_2/releases/tag/TicTacToe"),
        ],
    ),
    dict(
        slug="ur5e",
        title="Dynamic Control of a 6-DOF Robot Arm",
        short="Dynamic Control of a 6-DOF Robot Arm",
        thumb="assets/img/ur5e/thumb.jpg",
        meta="Coursework applied: RBE 501 (Robot Dynamics) and RBE 502 (Robot Control) at WPI.",
        blurb="A live model of a Universal Robots UR5e that applies the kinematics, dynamics and control from RBE 501 and RBE 502, using the masses, inertias and joint limits Universal Robots publishes for the arm.",
        tags=["JavaScript", "three.js", "Kinematics", "Dynamics", "Control", "Motion planning"],
        demo=UR5E_DEMO,
        body=[
            p("A live model of a Universal Robots UR5e that applies the kinematics, dynamics and control from RBE 501 (Robot Dynamics) and RBE 502 (Robot Control) at WPI. It uses the masses, inertias and joint limits that Universal Robots publishes for the arm."),
            p("The arm is built from the official UR5e description (Universal Robots, BSD-3-Clause): its joint origins, link masses, centres of mass, inertia tensors, joint torque limits and visual meshes. The code computes everything from those numbers while the page is open. Nothing is prerecorded."),
            h("From RBE 501"),
            ul("Forward kinematics by the product of exponentials, checked in a test against Universal Robots' published DH table.",
               "The space Jacobian built from the screw axes, and the manipulability ellipsoid and measures from its eigenvalues.",
               "Inverse kinematics by damped least squares, the method from Lecture 8.",
               "Inverse dynamics by the recursive Newton-Euler algorithm (Lecture 18), giving the joint torques.",
               r"Forward dynamics, solving for joint accelerations with the inverse of the mass matrix (Lecture 20). External forces enter through \(\tau = J^{T} F\) (Lecture 12).",
               "Quintic time scaling for trajectories (Lecture 19)."),
            h("From RBE 502"),
            ul(r"The manipulator equation \(M(q)\ddot q + C(q,\dot q)\dot q + g(q) = \tau\).",
               r"PD control, and PD control with gravity compensation. The lectures show that PD alone settles away from the target under gravity and that adding \(g(q)\) removes that offset. The demo shows both.",
               r"Feedback linearization (computed torque), which cancels the nonlinear terms so that the error follows \(\ddot e + K_d \dot e + K_p e = 0\)."),
            h("Planning"),
            p("The planning part is not from either course. It uses RRT-Connect (Kuffner and LaValle, 2000) with shortcut smoothing. Each link is a capsule and each obstacle is a sphere. The smoothed path is time-scaled until the joint speeds and the Newton-Euler torques stay inside the UR5e limits. When a sphere is dragged across the rest of the path, the arm plans again from where it is."),
            h("How it works"),
            KATEX,
            h3("Forward kinematics"),
            r"<div class='math'>$$T(\theta) = e^{[\mathcal{S}_1]\theta_1} e^{[\mathcal{S}_2]\theta_2} \cdots e^{[\mathcal{S}_6]\theta_6} M$$</div>",
            p(r"The six screw axes and the home pose \(M\) come from the UR5e joint origins. The teal arrows S1 to S6 on the arm are these axes, and the meshes move by this product every frame."),
            h3("Space Jacobian"),
            r"<div class='math'>$$J_{si}(\theta) = \mathrm{Ad}_{e^{[\mathcal{S}_1]\theta_1}\cdots e^{[\mathcal{S}_{i-1}]\theta_{i-1}}}\,\mathcal{S}_i$$</div>",
            p(r"Column \(i\) is the screw axis of joint \(i\) in the current pose."),
            h3("Manipulability"),
            r"<div class='math'>$$A = J_v J_v^{T}, \qquad \mu_3 = \sqrt{\det A}$$</div>",
            p(r"The grey ellipsoid at the tool has axes along the eigenvectors of \(A\) and half-lengths \(\sqrt{\lambda_i}\). It flattens as the arm nears a singularity."),
            h3("Inverse kinematics"),
            r"<div class='math'>$$\Delta\theta = J^{T}\left(JJ^{T} + \lambda^{2} I\right)^{-1} \mathcal{V}$$</div>",
            p("Damped least squares moves the tool toward the ring you drag. The damping keeps each step finite near a singularity."),
            h3("Recursive Newton-Euler"),
            r"<div class='math'>$$\mathcal{V}_i = \mathrm{Ad}_{T_{i,i-1}}\mathcal{V}_{i-1} + \mathcal{A}_i\dot\theta_i$$</div>",
            r"<div class='math'>$$\dot{\mathcal{V}}_i = \mathrm{Ad}_{T_{i,i-1}}\dot{\mathcal{V}}_{i-1} + \mathrm{ad}_{\mathcal{V}_i}\mathcal{A}_i\dot\theta_i + \mathcal{A}_i\ddot\theta_i$$</div>",
            r"<div class='math'>$$\mathcal{F}_i = \mathrm{Ad}^{T}_{T_{i+1,i}}\mathcal{F}_{i+1} + \mathcal{G}_i\dot{\mathcal{V}}_i - \mathrm{ad}^{T}_{\mathcal{V}_i}(\mathcal{G}_i\mathcal{V}_i), \qquad \tau_i = \mathcal{F}_i^{T}\mathcal{A}_i$$</div>",
            p(r"The forward pass carries velocities and accelerations out to the tool, with gravity entering as \(\dot{\mathcal{V}}_0 = (0, -\mathfrak{g})\). The backward pass carries wrenches back to the base. \(\mathcal{G}_i\) holds the published mass and inertia of each link."),
            h3("Equations of motion"),
            r"<div class='math'>$$M(q)\ddot q + C(q,\dot q)\dot q + g(q) = \tau$$</div>",
            p(r"The simulator solves this for \(\ddot q\) with \(M(q)\) assembled from Newton-Euler and integrates it at 1 kHz. Push the arm adds a 60 N force at the end of the forearm through \(J_s^{T}\mathcal{F}\)."),
            h3("Controllers"),
            r"<div class='math'>$$\tau = K_p e + K_d \dot e$$</div>",
            r"<div class='math'>$$\tau = K_p e + K_d \dot e + g(q)$$</div>",
            r"<div class='math'>$$\tau = M(q)(\ddot q_d + K_d\dot e + K_p e) + C(q,\dot q)\dot q + g(q)$$</div>",
            p(r"PD, PD with gravity compensation, and computed torque, with \(e = q_d - q\). PD alone sags under gravity, and the error plot shows the offset that \(g(q)\) removes."),
            h3("Path planning"),
            p(r"RRT-Connect grows one tree from the start and one from the goal in joint space. Each tree extends toward random samples and tries to connect to the other. A pose is rejected if any link capsule touches a sphere. The path is shortcut, then each segment gets the quintic time scaling \(s = 10\tau^3 - 15\tau^4 + 6\tau^5\) and is lengthened until speeds and torques stay inside the UR5e limits."),
            h("Checks"),
            p("These run as tests with Node:"),
            ul("Product-of-exponentials FK matches the DH FK to 1e-9 m over 500 random poses.",
               "The space Jacobian matches finite differences.",
               r"Newton-Euler torques match \(M(q)\ddot q + c + g\). The power \(\dot q^{T}\tau\) matches the rate of change of kinetic plus potential energy.",
               "Damped least squares converges in 99 of 100 trials.",
               "Every planned path is collision free when checked every 2 ms."),
        ],
        links=[("Demo source", "../assets/3d/ur5e/ur5e-demo.js", "local"),
               ("UR5e description", "https://github.com/UniversalRobots/Universal_Robots_ROS2_Description")],
    ),
    dict(
        slug="mapping",
        title="Autonomous Mapping and Localizing Robot",
        short="Autonomous Mapping and Localizing Robot",
        thumb="assets/img/mapping/maze.jpg",
        meta="RBE 3002 at WPI, spring 2025. Team project.",
        blurb="A TurtleBot3 that explores a maze it has never seen, builds a map of it with LiDAR, then uses that map to find where it is and drive to a goal.",
        tags=["ROS", "SLAM", "A*", "AMCL", "Python"],
        demo=TB3_DEMO,
        body=[
            p("The robot is dropped into a maze with no map. It has to explore the whole thing, build a map as it goes, and then, starting from an unknown spot, work out where it is on that map and drive to a goal."),
            fig("assets/img/mapping/maze.jpg", "The final maze in simulation."),
            h("Exploring"),
            p("To decide where to go next, the robot looks for frontiers: the edges between space it has already mapped and space it hasn't. It groups nearby frontier cells together, picks a group using its centre, and drives there. When there are no frontiers left, the map is done."),
            h("Mapping and planning"),
            p("The map is an occupancy grid built with LiDAR SLAM. We tried two mapping back ends, gmapping and Cartographer. Paths are planned with A* on the grid. The robot drives them without blocking the rest of the program, so it can keep updating the map while it moves."),
            h("Finding itself"),
            p("In the last phase the robot is placed somewhere in the finished maze and uses AMCL, a particle filter, to figure out where it is before driving to the goal."),
            fig("assets/img/mapping/world.jpg", "The test world used during development."),
            todo("Photo or video of the real robot"),
        ],
        links=[],
    ),
    dict(
        slug="tables4u",
        title="Tables4U",
        short="Tables4U",
        thumb="",
        meta="Software Engineering at WPI, fall 2024. Team project.",
        blurb="A restaurant reservation web app. Diners find a restaurant and book a table; owners manage their tables, hours and bookings.",
        tags=["Next.js", "React", "AWS Lambda", "MySQL", "Vercel"],
        body=[
            todo("Screenshot of the app"),
            p("Tables4U has three kinds of users. Diners search for restaurants that are open on a given date and time, book a table and cancel if they need to. Restaurant owners set up their restaurant, add tables, set their hours, close specific days and see who is booked. An administrator can see every restaurant and pull availability reports."),
            h("How it's built"),
            p("We designed it in UML first. The front end is Next.js, React and Tailwind CSS, deployed on Vercel. The back end is a set of REST APIs, each one an AWS Lambda function behind API Gateway, with the data in a MySQL database on Amazon RDS."),
        ],
        links=[("Code on GitHub", "https://github.com/ronak-wani/Tables4u")],
    ),
]
