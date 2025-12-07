# Humane Mouse Coexistence Principles

**Version:** 2.1
**Date:** December 2, 2025
**Author:** Wade Hargrove
**Contact:** [your email]

---

## Purpose

This document establishes principles for humane coexistence between humans and mice. It goes beyond "humane trapping" to address the complete problem: how do we share space with mice in ways that minimize suffering for both species?

**This document is published as a defensive publication and open standard.** Anyone may implement these principles. The author encourages adoption and improvement of these standards to prevent animal suffering.

---

## The Uncomfortable Truth About "Humane" Trapping

The pest control industry markets live-capture traps as the humane alternative. This is a comforting half-truth that allows us to feel good while potentially causing more suffering than a quick-kill trap.

### Problem 1: Unmonitored Live Traps Are Death Traps

A mouse in an unmonitored live trap faces:
- **Dehydration** within 12-24 hours (primary cause of death)
- **Stress-induced health issues** (heart failure, shock)
- **Starvation** if trapped longer
- **Temperature exposure** (hypothermia or heat stroke)

An unmonitored "humane" trap is arguably *less* humane than a snap trap that kills instantly.

### Problem 2: "Release 2 Miles Away" Is Often a Death Sentence

The standard advice to release mice "at least 2 miles away" sounds kind. The reality:

- **Only 5% of wild mice survive their first year** even in familiar territory
- Mice released in unfamiliar territory face: no established shelter, no food caches, no knowledge of predators, territorial aggression from resident mice
- **Urban mice released in rural areas** lack survival skills for that environment
- You may be separating **nursing mothers from babies** who will die in your walls
- PETA actually recommends releasing within 100 yards - acknowledging that distance often equals death

The feel-good act of driving a mouse 2 miles away may cause more suffering than a quick death would have.

### Problem 3: Trapping Doesn't Solve the Problem

As long as entry points and food sources exist, new mice will arrive. Trapping is treating symptoms, not the disease. You can trap forever and never be mouse-free.

---

## A Better Framework: The Coexistence Hierarchy

Instead of "how do we trap mice humanely," we should ask: **"How do we minimize suffering while managing human-mouse conflicts?"**

This requires a hierarchy of interventions, prioritized by effectiveness and humaneness:

### Level 1: Prevention (Most Humane)

**Goal:** Mice never enter human spaces in the first place.

If a mouse never gets into your home, no one suffers. No stress, no trapping, no release anxiety, no death. This is the most humane outcome for everyone.

**Methods:**
- **Exclusion:** Seal entry points (mice fit through 1/4 inch gaps)
- **Food source elimination:** Secure food storage, clean crumbs, manage garbage
- **Habitat modification:** Remove nesting materials, reduce clutter

**Why this is best:**
- Zero animal suffering
- Zero ongoing effort once complete
- Permanent solution (trapping is forever)
- Cost-effective long-term ($400-500 one-time vs. perpetual pest control)

### Level 2: Fertility Management (Population Stabilization)

**Goal:** If mice are present, stabilize population without killing.

Mice reproduce rapidly (5-10 litters per year, 5-6 pups each). Killing individual mice doesn't reduce population - survivors simply breed faster. Fertility control addresses the source.

**Existing solutions:**
- **Evolve Soft Bait** (mice): Cottonseed oil (gossypol) - interferes with reproduction in both sexes
- **ContraPest** (rats): VCD + Triptolide - ceases ovulation and sperm production
- Both are EPA-approved, safe for pets and predators

**Why this works:**
- Population stabilizes within 1-2 breeding cycles (4-6 weeks)
- No secondary poisoning of predators
- More effective than kill methods long-term
- Allows natural attrition rather than violent death

### Level 3: Detection & Monitoring

**Goal:** Know when mice are present before infestation.

Early detection allows intervention before populations explode. This is where smart technology adds value.

**Methods:**
- Activity monitoring at common entry points
- Non-capture detection (cameras, motion sensors, ToF sensors)
- Consumption monitoring of fertility bait stations

### Level 4: Live Capture with Rapid Response

**Goal:** If capture is necessary, ensure quick discovery and appropriate release.

This is where smart trap monitoring becomes critical - but it's level 4, not level 1. Capture should be a last resort after prevention and fertility management.

**Requirements:**
- Escalating notification system (see detailed principles below)
- Local release guidance (not "2 miles away")
- Welfare timeline awareness

### Level 5: Lethal Methods (Last Resort)

**Goal:** If lethal control is unavoidable, minimize suffering.

We acknowledge that some situations may require lethal control. If so:
- Quick-kill traps (snap traps) are more humane than slow methods
- **Never use glue traps** - they cause prolonged suffering and often trap non-target animals
- **Never use anticoagulant poisons** - slow death over days, secondary poisoning of predators

---

## The Ecological Context

Before we discuss eliminating mice, we should understand their role:

### Mice Have Value in Ecosystems

- **Food chain:** Primary food source for hawks, owls, snakes, bobcats - removing mice affects predators
- **Seed dispersal:** Mice bury seeds, contributing to plant regeneration
- **Soil health:** Burrowing aerates soil
- **Scientific importance:** House mice have coevolved with humans for 11,000+ years

### The Problem Is Conflict, Not Mice

Mice become a "problem" when they:
- Enter human living/food storage spaces
- Damage property (gnawing wires, insulation)
- Spread disease (rare, but real)
- Reproduce to infestation levels

The goal isn't to eliminate mice from Earth. It's to prevent conflict while respecting their place in the ecosystem.

---

## Smart Trap Monitoring Principles

When live capture is necessary (Level 4), these principles ensure the trap is actually humane:

### The Mouse Welfare Timeline

| Time | Status | Urgency |
|------|--------|---------|
| 0-2 hours | Stressed but healthy | Low - Normal notification |
| 2-4 hours | Increasing stress | Medium - Repeat notifications |
| 4-8 hours | Dehydration beginning | High - Aggressive notification |
| 8-12 hours | Serious health risk | Critical - Override DND |
| 12-24 hours | Survival unlikely | Emergency - All channels |
| 24+ hours | Death likely | - |

### Principle 1: Detection Must Be Reliable

False negatives (missed captures) are unacceptable - they result in animal death.

**Requirements:**
- Near-zero false negative rate
- Multiple readings over time to confirm
- Battery alerts before detection capability is compromised
- Local indication regardless of network

### Principle 2: Notification Must Escalate

One notification is not enough. Humans miss notifications.

**Required escalation:**

| Level | Timing | Actions |
|-------|--------|---------|
| 1 | Immediate | Push notification |
| 2 | 1-2 hours | Repeat notification, email |
| 3 | 2-4 hours | Device buzzer begins, more frequent alerts |
| 4 | 4-8 hours | SMS to emergency contacts, override DND |
| 5 | 8+ hours | All channels, continuous alarm |

### Principle 3: Autonomous Device Operation

Network fails. Servers crash. The device must protect the animal independently.

- Store alert state in non-volatile memory
- Escalate locally (buzzer, LED) without network
- Device state is authoritative

### Principle 4: Visible Failure Modes

Silent failures kill mice. Every failure must be indicated:
- Low battery warning before critical
- Network disconnection visible
- Sensor failure alerts
- Missed check-in alerts

### Principle 5: Minimize Notification Latency

Every minute matters. Detection-to-notification < 30 seconds.

### Principle 6: System Must Be Testable

Test alert function that exercises full notification path.

### Principle 7: Multi-User Support

Multiple people can receive alerts. Emergency contacts for escalation.

---

## Release Ethics: The Honest Conversation

### What "Humane Release" Actually Means

Releasing a trapped mouse humanely requires honest consideration of what gives that mouse the best chance of survival:

**Release near capture site (within 100 yards):**
- Mouse knows the territory
- Has existing food sources and shelter knowledge
- May return to your home (if entry points remain)
- Highest survival probability

**Release in "suitable habitat" nearby:**
- Wooded area, brush pile, outbuilding on your property
- Provides immediate shelter
- Close enough that mouse isn't completely disoriented
- Moderate survival probability

**Release 1-2+ miles away:**
- Mouse is in completely unfamiliar territory
- No knowledge of food sources, shelter, or predators
- Must compete with established resident mice
- Low survival probability
- *This may cause more suffering than a quick death*

### Recommendations

1. **Seal entry points BEFORE releasing** - Otherwise the mouse (or others) will return
2. **Release at dusk** - Mice are nocturnal, darkness provides cover
3. **Provide transition resources** - Leave a small amount of food and nesting material
4. **Release in appropriate habitat** - Urban mouse → urban-adjacent area, not deep woods
5. **Consider nursing mothers** - A trapped female may have nursing babies; release quickly and nearby
6. **Be honest with yourself** - If you're driving 5 miles to release, ask why. Is it for the mouse, or for you?

### The Truly Humane Path

The most humane approach to a mouse problem:

1. **Seal all entry points** - Prevent the problem
2. **Deploy fertility bait** - Stabilize any existing population
3. **If you must trap:** Release locally (same property, outdoor structure)
4. **Accept coexistence** - A few outdoor mice on your property aren't a problem

---

## Entry Point Scanner: AI-Assisted Home Inspection

Prevention requires knowing where mice might enter. The Entry Point Scanner uses a smartphone camera with AI-assisted detection to identify potential entry points throughout a home.

### The Problem

Professional exclusion services cost $400-500+ and require scheduling. Most homeowners don't know what to look for or where to look. Common advice like "seal gaps" isn't actionable without knowing which gaps matter.

### The Solution

A smartphone app that guides users through a systematic home inspection, using computer vision to identify and highlight potential mouse entry points in real-time.

### How It Works

**Guided Walkthrough:**
The app guides users through a systematic inspection of common entry point locations:

| Area | What to Scan | What AI Detects |
|------|--------------|-----------------|
| **Foundation perimeter** | Where siding meets foundation | Cracks, gaps, deteriorated mortar |
| **Door bottoms** | Gap between door and threshold | Gaps > 1/4 inch, worn sweeps |
| **Garage door** | Seal along bottom and sides | Worn seals, gnaw damage, gaps |
| **Utility entry** | Pipes, wires, conduits entering home | Unsealed penetrations, gaps around pipes |
| **Dryer vent** | External vent flap | Missing/damaged flaps, gaps |
| **Window wells** | Basement window wells | Uncovered drains, gaps |
| **Roof/soffit** | Eaves, soffits, roof vents | Damaged vents, gaps in eaves |
| **HVAC** | AC lines, furnace vents | Unsealed penetrations |

**Real-Time Detection:**
- AR overlay highlights detected gaps/holes on camera view
- Color-coded by severity (red = mouse-accessible, yellow = potential, green = sealed)
- Size estimation where possible (especially with LiDAR-equipped phones)

**Generated Output:**
- Prioritized checklist of entry points to seal
- Photo documentation of each issue
- Material recommendations for each type of gap
- DIY instructions or professional referral suggestions

### Technical Approach

**Phase 1: Guided Checklist (No AI Required)**
- App guides user through inspection points with reference photos
- User manually photographs and marks "sealed" or "needs work"
- Generates checklist and sealing instructions
- Can ship quickly, collects training data for Phase 2

**Phase 2: AI-Assisted Detection**
- Train model on:
  - User-submitted photos from Phase 1 (with consent)
  - Professional pest control inspection images
  - Synthetic data (generated gap images)
- On-device inference using Core ML (iOS) / TensorFlow Lite (Android)
- Real-time bounding boxes around detected gaps

**Phase 3: AR Measurement**
- Use phone depth sensors (LiDAR on iPhone Pro, ToF on some Android)
- Measure gap dimensions: "This gap is 0.3 inches - a mouse can fit through"
- More precise material recommendations based on measured size

### Training Data Requirements

**Positive examples (entry points):**
- Gaps under doors (various sizes, lighting conditions)
- Utility penetrations (pipes, wires, conduits)
- Foundation cracks
- Damaged weather stripping
- Worn garage door seals
- Uncovered dryer vents
- Window well drains

**Negative examples (not entry points):**
- Properly sealed penetrations
- Intact weather stripping
- Gaps too small for mice (< 1/4 inch)
- Decorative gaps (intentional ventilation)

**Annotation requirements:**
- Bounding box around gap
- Classification: mouse-accessible / too small / properly sealed
- Location type: door / window / foundation / utility / roof

### Key Detection Challenges

| Challenge | Mitigation |
|-----------|------------|
| Variable lighting | Train on diverse lighting; require flash in dark areas |
| Perspective distortion | Guide user to photograph straight-on |
| Scale ambiguity | Include reference object or use depth sensor |
| False positives (intentional gaps) | Location context helps (weep holes are expected) |
| Occluded gaps (behind objects) | Guide user to move obstacles; can't detect what can't be seen |

### Mouse Entry Point Reference

Mice can squeeze through any gap they can fit their skull through - approximately **1/4 inch (6mm)** or the diameter of a pencil.

**Most common entry points (in order of frequency):**

1. **Gaps around utility pipes** - Where plumbing/gas enters the home
2. **Door sweeps** - Worn or missing sweeps under exterior doors
3. **Garage door seals** - Especially corners where seal meets frame
4. **Foundation cracks** - Temperature cycling creates gaps over time
5. **Dryer/exhaust vents** - Missing or damaged flaps
6. **Window well drains** - Direct path to basement if uncovered
7. **Soffits and eaves** - Gaps where roof meets walls
8. **AC line penetrations** - Often poorly sealed
9. **Cable/phone line entry** - Small holes that add up
10. **Chimney gaps** - Where chimney meets roofline

### Sealing Material Recommendations

The app should recommend appropriate materials based on gap type:

| Gap Type | Recommended Material |
|----------|---------------------|
| Small holes (< 1/2 inch) | Steel wool + caulk |
| Medium gaps (1/2 - 1 inch) | Hardware cloth + expanding foam |
| Large holes (> 1 inch) | Metal flashing, concrete patch |
| Door bottoms | Door sweep replacement |
| Pipe penetrations | Escutcheon plates + caulk |
| Foundation cracks | Hydraulic cement |
| Weather stripping | Replace with new stripping |

**Important:** Mice can chew through foam, plastic, and wood. Always use steel wool, hardware cloth, or metal for permanent exclusion.

### Integration with Ecosystem

The Entry Point Scanner connects to the broader coexistence system:

```
┌─────────────────────────────────────────────────────────────────┐
│                    User Journey                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. SCAN          2. SEAL           3. MONITOR      4. VERIFY   │
│  ┌──────────┐    ┌──────────┐     ┌──────────┐    ┌──────────┐ │
│  │ Scanner  │───▶│ Checklist│────▶│  Scout   │───▶│ Re-scan  │ │
│  │  (App)   │    │ & Guides │     │ (Device) │    │  (App)   │ │
│  └──────────┘    └──────────┘     └──────────┘    └──────────┘ │
│       │                                  │               │       │
│  "Find entry      "Seal with           "Watch for      "Verify  │
│   points"          steel wool"          activity"       sealed" │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Post-Exclusion Verification:**
After sealing, user rescans to verify all identified gaps are addressed. The app compares before/after photos and confirms exclusion is complete.

**Scout Device Placement:**
Scanner identifies key entry points; Scout devices can be placed at highest-risk locations for ongoing monitoring.

**Trap Placement Guidance:**
If trapping becomes necessary, scanner data informs optimal trap placement near identified activity paths.

### Privacy Considerations

- All image processing can be done on-device (no cloud required)
- Photos stored locally unless user explicitly shares
- No personally identifiable information in detection model
- User controls what data (if any) is shared for model improvement

### Differentiation from Existing Solutions

| Existing Solutions | Entry Point Scanner |
|-------------------|---------------------|
| Professional inspection ($400-500) | Free app, DIY |
| General home inspection AI | Mouse-entry-specific detection |
| Enterprise pest management tools | Consumer-friendly interface |
| Generic "seal your home" advice | Specific, prioritized, visual guidance |
| One-time inspection | Repeatable verification |

---

## The Scout Device Concept: Entry Point Monitoring

The Entry Point Scanner identifies where to focus attention. Scout devices provide **ongoing monitoring** at those locations to detect activity before infestation.

### Purpose

- Detect mouse activity at entry points (garage, basement, utility penetrations)
- Alert homeowners to seal entry points proactively
- Monitor exclusion effectiveness after sealing

### Technical Approach

- Simplified sensor array (ToF or PIR)
- Battery-optimized (months of operation)
- Activity logging with threshold alerts
- No capture mechanism - detection only

### Use Cases

1. **Pre-problem:** "I don't have mice yet, but I want to know if they try to get in"
2. **Post-exclusion:** "I sealed the holes, are mice still getting in?"
3. **Seasonal monitoring:** "Mice seek shelter in fall - am I protected?"

### Benefits

- Prevents the need for trapping entirely
- Non-invasive (no capture stress)
- Proactive rather than reactive

---

## Fertility Bait Station Integration

Smart monitoring can enhance fertility control effectiveness:

### Concept

- Monitor bait consumption in Evolve-compatible stations
- Track consumption patterns over time
- Alert when bait needs refilling
- Correlate with activity data from Scout devices

### Why This Matters

Fertility control works, but requires consistent bait availability. Monitoring ensures:
- Bait stations don't run empty
- Consumption data indicates population presence
- Can measure effectiveness over breeding cycles

### Integration with Existing Products

- Partner with SenesTech (Evolve manufacturer) or offer compatible stations
- Monitoring retrofit for existing bait stations
- Data correlation with trap monitoring system

---

## Implementation Recommendations

### Hardware Platform

- **Microcontroller:** ESP32 series (WiFi, BLE, low power modes)
- **Detection sensor:** VL53L0X/VL53L1X Time-of-Flight
- **Local indication:** Piezo buzzer, bright LED
- **Power:** Rechargeable battery with monitoring
- **Optional camera:** Visual confirmation, AI species identification

### Product Variants

| Product | Type | Purpose | Features |
|---------|------|---------|----------|
| **Entry Point Scanner** | App | Level 1 - Find entry points | AI detection, guided inspection, sealing guides |
| **Scout** | Device | Level 1/3 - Monitor entry points | Ultra-low-power, long battery, activity alerts |
| **Bait Monitor** | Device | Level 2 - Fertility station monitoring | Consumption sensing, refill alerts |
| **Trap Monitor** | Device | Level 4 - Live capture monitoring | Full escalation, camera, battery backup |

### Software Platform

- Unified app for all device types
- Coexistence guidance (not just alerts)
- Entry point identification assistance
- Release location recommendations
- Educational content on mouse behavior

---

## Anti-Patterns: What NOT to Do

### Don't: Sell traps without escalation
A "smart trap" that sends one notification is not humane.

### Don't: Recommend distant release
Stop telling people to drive mice 2 miles away. It's not kind.

### Don't: Ignore prevention
Selling traps without discussing exclusion perpetuates the cycle.

### Don't: Use glue traps - ever
Glue traps cause extended suffering and catch non-target animals.

### Don't: Promote anticoagulant poisons
Slow death, secondary poisoning of predators.

### Don't: Market "humane" without substance
The word "humane" requires actual welfare consideration, not just marketing.

---

## Certification Criteria

A system claiming compliance with these principles should demonstrate:

### Trap Monitoring Certification
1. Detection reliability: < 1% false negative rate
2. Notification latency: < 60 seconds
3. Escalation: At least 4 levels over 8+ hours
4. Offline operation: Device escalates locally for 24+ hours
5. Persistence: Alert state survives power loss
6. Multi-user: At least 2 notification recipients
7. Testability: One-button test function
8. Battery warning: 24+ hours before critical

### Coexistence System Certification
All trap requirements, plus:
1. Prevention guidance: System educates on exclusion
2. Release guidance: Location-appropriate release recommendations
3. Fertility integration: Compatible with non-lethal population management
4. Entry monitoring: Scout device option available
5. Educational content: Mouse behavior and coexistence information

---

## Licensing

This document is released under [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

You are free to:
- Share, copy, and redistribute
- Adapt, remix, transform, and build upon
- Use for commercial purposes

Under the following terms:
- **Attribution:** Credit this document, provide a link

---

## References and Further Reading

### Rodent Fertility Control
- [ContraPest - Wikipedia](https://en.wikipedia.org/wiki/ContraPest)
- [SenesTech Evolve Products](https://senestech.com/)
- [Developing Fertility Control for Rodents - Wiley](https://onlinelibrary.wiley.com/doi/10.1111/1749-4877.12727)

### Humane Release Guidelines
- [PETA - Living in Harmony with House Mice](https://www.peta.org/issues/wildlife/living-harmony-wildlife/house-mice/)
- [Humane Society - What to Do About Wild Mice](https://www.humanesociety.org/resources/what-do-about-wild-mice)
- [Wildlife Removal USA - Do Relocated Mice Survive?](http://wildliferemovalusa.com/micerelocate.html)

### Integrated Pest Management
- [Mass Audubon - Poison-Free Pest Control](https://www.massaudubon.org/take-action/advocate/poison-free-pest-control)
- [Wild Care - Humane Rodent Control Solutions](https://www.wildcarecapecod.org/wildlife-assistance/humane-rodent-control-solutions/)

### Ecological Role of Mice
- [Skedaddle Wildlife - Role of Wild Mice in Ecosystems](https://www.skedaddlewildlife.com/location/coquitlam/blog/the-role-of-wild-mice-in-the-ecosystem/)

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-01 | Initial publication (trap monitoring focus) |
| 2.0 | 2025-12-01 | Expanded to coexistence framework, added release ethics, fertility integration, scout concept |
| 2.1 | 2025-12-02 | Added Entry Point Scanner concept with AI-assisted detection, training data requirements, phased implementation |

---

## Contact

For questions, suggestions, or to report implementations:

**Wade Hargrove**
[Email]
[Website/GitHub]

---

*"The most humane trap is the one you never need to use."*
