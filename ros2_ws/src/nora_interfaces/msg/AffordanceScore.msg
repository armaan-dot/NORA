# AffordanceScore — affordance scoring result for a single skill
string skill_name       # skill being scored
float32 usefulness      # how relevant the skill is to the intent [0.0, 1.0]
float32 feasibility     # how likely execution will succeed [0.0, 1.0]
float32 combined_score  # weighted combination of usefulness * feasibility
string breakdown_json   # JSON-encoded score breakdown / reasoning
