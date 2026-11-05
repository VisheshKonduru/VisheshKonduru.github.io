"""Activities page content. Facts come only from the old Journey page, the resume
.tex files and the existing pages. Anything not known is listed in todo (rendered only as "More coming soon.").

Each activity:
  id, label (short, shown on the photo), title, years, role, honors, text (HTML),
  cover: (src, alt) or None, more: list of extra media HTML (see media helpers in build.py),
  todo: list of missing facts (not shown on the page).
"""

ACTIVITIES = [
    dict(
        id="vex-u", label="VEX U", title="WPI VEX U Robotics",
        years="April 2023 to now",
        role="Secretary, marketing head/media lead, build lead, driver and programmer",
        honors=["Competed at the VEX U World Championship"],
        text=(
            "<p>I lead the construction and programming of our robots. I organized our tasks with agile and scrum, "
            "which raised team participation 70%.</p>"
            "<p>Seasons so far: Over Under (2023 to 2024), High Stakes (2024 to 2025) and Push Back (2025 to 2026). "
            'For Push Back, our MQP team also built a robot that plays the whole match by itself. '
            '<a href="projects/mqp.html">Read about the robot</a>.</p>'
        ),
        cover=("assets/video/vex_worlds_poster.jpg", "A VEX U match seen from the driver's spot."),
        more=[
            ("video", "assets/video/vex_worlds.mp4", "A match from the driver&rsquo;s spot, May 2025."),
            ("yt", "1kmXXycRsSI", "VEX U 2024-25 endgame climb interview"),
            ("img", "assets/img/mqp/robot.jpg", "The autonomous Push Back robot."),
            ("3d", "assets/3d/robots/vexu.glb", "Robot CAD"),
            ("3d", "assets/3d/robots/vex_a.glb", "Robot CAD"),
            ("3d", "assets/3d/robots/vex_b.glb", "Robot CAD"),
        ],
        todo=["Photo: 2023-24 robot (Over Under)", "Photo: VEX U World Championship"],
    ),
    dict(
        id="frc", label="FRC", title="FRC Team 3735 VorTX",
        years="High school",
        role=None,
        honors=[],
        text="<p>I started building robots in high school on FRC and VEX teams.</p>",
        cover=("assets/img/activities/frc_1.jpg", "Me in the pits with our 2022-23 robot, Team 3735."),
        more=[
            ("img", "assets/img/activities/frc_2.jpg", "Our 2022-23 robot in the pits."),
            ("video", "assets/video/hs_frc_climb.mp4", "Our 2021-22 FRC robot climbing in the endgame."),
            ("video", "assets/video/hs_outreach.mp4", "FRC Team 3735 VorTX at Siemens Energy Day."),
        ],
        todo=["Role on the team", "Exact years on the team"],
    ),
    dict(
        id="vrc", label="VRC", title="VEX Robotics Competition",
        years="High school",
        role=None, honors=["TSA Texas State Championship winner, VEX, 2023"],
        text="<p>Alongside FRC, I built robots on a VEX team in high school.</p>",
        cover=("assets/img/activities/vrc_1.jpg", "Our team with our VEX robot at the 2023 TSA Texas State Championship."),
        more=[
            ("img", "assets/img/activities/vrc_2.jpg", "Our team with our robots at the 2023 TSA Texas State Championship."),
        ],
        todo=["Team name and number", "Role on the team", "Exact years"],
    ),
    dict(
        id="ftc", label="FTC", title="FIRST Tech Challenge",
        years=None, role=None, honors=[],
        text="<p>FTC is one of the competitions where I have volunteered, part of more than 400 hours at VEX, FRC, FTC and FLL events.</p>",
        cover=None, more=[],
        todo=["Photo: FTC", "Role (team member, volunteer, or both)", "Years"],
    ),
    dict(
        id="orchestra", label="Orchestra", title="Orchestra",
        years="Sixth grade to now: middle school, Klein High School and WPI",
        role="Violin", honors=["First place, Festival Disney, 2019 to 2020", "Performed at the 75th Midwest Clinic International Band and Orchestra Conference, Chicago, December 17, 2021"],
        text=(
            "<p>I have played violin since sixth grade, in orchestra through middle school and high school and now in the WPI Orchestra.</p>"
            "<p>With the Klein High School Chamber Orchestra, conducted by Creston Herron, I performed at the 75th annual <a href='https://www.midwestclinic.org/midwest-clinic-performing-organization?gid=4864&amp;pyear=2021'>Midwest Clinic International Band and Orchestra Conference</a> at McCormick Place in Chicago on December 17, 2021. The concert was released by Mark Records as <a href='https://open.spotify.com/album/6imbxGOJWm5n9EEnIwxcQD'>2021 Midwest Clinic: Klein High School Chamber Orchestra (Live)</a>. "
            "At the clinic I met the composers Soon Hee Newbold, Yukiko Nishimura and Javier Pinell. In 2019 to 2020 our high school orchestra won first place at Festival Disney.</p>"
        ),
        cover=("assets/img/activities/orchestra_young.jpg", "Me playing violin when I was younger."),
        more=[("img", "assets/img/activities/orchestra_wpi.jpg", "Playing violin in a string section, left."),
              ("img", "assets/img/activities/orchestra_midwest_newbold.jpg", "With composer Soon Hee Newbold at the Midwest Clinic in Chicago, 2021."),
              ("img", "assets/img/activities/orchestra_midwest_nishimura.jpg", "With composer Yukiko Nishimura at the Midwest Clinic, 2021."),
              ("img", "assets/img/activities/orchestra_midwest_pinell.jpg", "With composer Javier Pinell at the Midwest Clinic, 2021.")],
        todo=[],
    ),
    dict(
        id="sase", label="SASE", title="SASE, Society of Asian Scientists and Engineers",
        years=None, role=None, honors=[], text="",
        cover=None, more=[],
        todo=["Photo: SASE", "Chapter (WPI?)", "Role", "Years", "What you did"],
    ),
    dict(
        id="outreach", label="Robotics Outreach", title="Robotics Outreach Assistant, WPI",
        years="February 2024 to May 2026",
        role="Robotics Outreach Assistant",
        honors=[],
        text=(
            "<p>I organized outreach events and produced social media content for Admissions, "
            "raising participation 70% and engagement 90%.</p>"
            "<p>I also built a pandas pipeline over multi-year applicant and alumni records to model the trends that shaped Admissions outreach.</p>"
        ),
        cover=None, more=[],
        todo=["Photo: an outreach event"],
    ),
    dict(
        id="student-solutions", label="Student Solutions", title="Student Solutions",
        years=None, role=None, honors=[],
        text="<p>Connected high school computer science clubs across Texas.</p>",
        cover=None, more=[],
        todo=["Photo: Student Solutions", "Role", "Years", "How many clubs, and what the network did"],
    ),
    dict(
        id="hack-the-flow", label="Hack the Flow", title="Hack the Flow",
        years=None, role=None, honors=[],
        text="<p>A hackathon.</p>",
        cover=None, more=[],
        todo=["Photo: Hack the Flow", "Role (organizer or participant)", "Year", "What you built or ran"],
    ),
]
