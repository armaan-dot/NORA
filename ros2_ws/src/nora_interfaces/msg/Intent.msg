# Intent — parsed semantic intent from a natural-language command
string version          # schema version, e.g. "1.0"
string command_id       # unique ID for this command instance (UUID)
string raw_text         # original utterance or text command
string action           # high-level action verb, e.g. "pick", "place", "move"
string target_object    # primary object of the action, e.g. "red_cube"
string target_location  # destination or reference location, e.g. "table_left"
string parameters_json  # JSON-encoded extra parameters
float32 confidence      # overall parse confidence [0.0, 1.0]
