# SkillCall — a single invocation record for an executable skill
string skill_name           # registered skill identifier, e.g. "pick_skill"
string intent_id            # command_id of the originating Intent
string params_json          # JSON-encoded skill-specific parameters
builtin_interfaces/Time timestamp  # time the skill was dispatched
