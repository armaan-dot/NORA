"""Dataset generator and loader for NORA NLU.

Provides seed commands and template-based synthetic command generation,
including direct commands (pick, place, move, grippers, home) and
indirect commonsense commands (e.g. "I am hungry" -> pick snack,
"I am going to play" -> pick game_controller, "I am bored" -> pick fidget_spinner).
"""

from __future__ import annotations

import json
from pathlib import Path
import random
from typing import Any
import uuid

_OBJECTS = [
    # Beverages & Drinkware
    "water_glass", "glass", "glass_cup", "coffee_mug", "mug", "paper_cup", "plastic_cup", "tea_cup",
    "water_bottle", "thermos", "tumbler", "coke", "pepsi", "sprite", "soda_can", "energy_drink",
    "juice_box", "milk_carton", "coffee_cup", "sports_drink", "sparkling_water", "beer_can", "tea_bag",
    "coffee_pod", "juice_bottle", "protein_shake", "straw", "coaster", "lid", "drink_can", "wine_glass",
    "drink", "water", "beverage", "hot_chocolate", "iced_tea", "smoothie_cup", "lemonade_can",

    # Containers & Organization
    "trash_bin", "recycle_bin", "pencil_holder", "pen_cup", "desk_organizer", "storage_box",
    "cardboard_box", "shoebox", "bowl", "plate", "tray", "basket", "tupperware", "lunch_box", "jar",
    "tin_can", "paper_bag", "plastic_bag", "tote_bag", "backpack", "pouch", "pencil_case", "card_holder",
    "file_organizer", "magazine_holder", "drawer_box", "bucket", "small_crate", "cup_holder", "phone_stand",
    "paper_tray", "document_tray", "desk_caddy", "expanding_file", "manila_folder", "pocket_folder",

    # Stationery & Office Supplies (Expanded with 80+ comprehensive stationery items)
    "pen", "ballpoint_pen", "gel_pen", "fountain_pen", "pencil", "mechanical_pencil", "marker",
    "whiteboard_marker", "permanent_marker", "highlighter", "crayon", "colored_pencil", "eraser",
    "pencil_sharpener", "ruler", "protractor", "compass_tool", "set_square", "tape", "masking_tape",
    "duct_tape", "tape_dispenser", "stapler", "staples_box", "staple_remover", "hole_punch", "paper_clip",
    "binder_clip", "rubber_band", "push_pin", "thumbtack", "glue_stick", "glue_bottle", "scissors",
    "box_cutter", "sticky_notes", "notebook", "notepad", "sketchbook", "textbook", "book", "magazine",
    "paper", "index_cards", "folder", "binder", "envelope", "clipboard", "whiteboard_eraser", "calendar",
    "correction_tape", "white_out", "liquid_glue", "craft_glue", "washi_tape", "double_sided_tape",
    "packing_tape", "craft_knife", "precision_knife", "cutting_mat", "paper_trimmer", "two_hole_punch",
    "three_hole_punch", "paper_fastener", "brass_fastener", "binder_divider", "index_tab", "sticky_tabs",
    "page_marker", "legal_pad", "steno_pad", "composition_notebook", "spiral_notebook", "graph_paper",
    "grid_notebook", "tracing_paper", "construction_paper", "cardstock", "craft_paper", "drawing_pad",
    "watercolor_pad", "paint_palette", "watercolor_set", "acrylic_paint", "oil_pastel", "chalk_pastel",
    "calligraphy_pen", "calligraphy_brush", "charcoal_pencil", "graphite_pencil", "colored_markers",
    "fine_liner", "permanent_pen", "dry_erase_pen", "gel_pen_refill", "pencil_lead", "lead_refill",
    "drafting_compass", "t_square", "architect_ruler", "stencil_ruler", "rubber_stamp", "stamp_pad",
    "date_stamp", "desk_blotter", "document_folder", "laminating_pouch", "label_maker", "label_roll",
    "sticky_flags", "bookmark", "chalk", "chalkboard_eraser", "dry_erase_spray", "dry_erase_cloth",
    "clipboard_clip", "badge_holder", "lanyard_strap", "badge_reel", "notecard_box", "receipt_spike",
    "magnifying_ruler", "carbon_paper", "binder_pocket",

    # Electronics & Gadgets
    "phone", "smartphone", "tablet", "laptop", "keyboard", "mouse", "mouse_pad", "webcam", "headphones",
    "earbuds", "earbud_case", "charger", "phone_charger", "power_bank", "usb_cable", "usb_drive", "sd_card",
    "hdmi_cable", "power_adapter", "extension_cord", "calculator", "remote", "tv_remote", "game_controller",
    "speaker", "smartwatch", "watch", "camera", "microphone", "flashlight", "batteries", "aa_battery",
    "light_bulb", "desk_lamp", "alarm_clock", "router", "hard_drive", "raspberry_pi", "arduino_board",
    "breadboard", "jumper_wire", "multimeter", "soldering_iron", "led", "resistor", "motor", "servo",
    "sensor_module", "circuit_board", "vr_headset", "wireless_mouse", "mouse_dongle", "stylus",
    "stylus_pen", "tablet_pen", "power_strip", "charging_brick", "usb_hub", "bluetooth_speaker",

    # Tools & Hardware
    "screwdriver", "phillips_screwdriver", "flathead_screwdriver", "hex_key", "allen_key", "wrench",
    "adjustable_wrench", "pliers", "needle_nose_pliers", "wire_cutters", "wire_stripper", "hammer",
    "tape_measure", "utility_knife", "level_tool", "clamp", "bolt", "nut", "screw", "washer", "zip_tie",
    "cable_tie", "sandpaper", "file_tool", "drill_bit", "tweezers", "magnifying_glass", "spring", "gear",
    "bearing", "bracket", "spool_of_wire", "hot_glue_gun", "allen_wrench_set", "toolbox", "screw_box",
    "oil_can", "spray_can", "paint_brush", "paint_tube", "pocket_knife", "multitool",

    # Food & Snacks (Expanded for hunger, eating & kitchenware)
    "apple", "banana", "orange", "lemon", "pear", "grapes", "peach", "mango", "strawberry", "tomato",
    "cucumber", "carrot", "snack", "snack_bar", "granola_bar", "chocolate_bar", "candy", "gum", "mint_box",
    "chips_bag", "cookie", "cracker", "biscuit_pack", "sandwich", "bread", "donut", "muffin",
    "instant_noodles", "cereal_box", "yogurt_cup", "sauce_packet", "salt_shaker", "pepper_shaker",
    "sugar_packet", "honey_jar", "peanut_butter_jar", "egg", "popcorn_bag", "nuts_pack", "dried_fruit_pack",
    "burger", "pizza_slice", "croissant", "bagel", "toast", "pancake", "waffle", "cereal_bowl",
    "oatmeal_cup", "salad_bowl", "soup_bowl", "soup_can", "noodles_cup", "ramen_pack", "protein_bar",
    "energy_bar", "trail_mix", "pretzels", "popcorn_bowl", "potato_chips", "tortilla_chips", "gummy_candy",
    "lollipop", "apple_slice", "orange_slice", "blueberries", "blackberries", "raspberries", "cheese_stick",
    "cheese_block", "yogurt_pot", "fork", "spoon", "knife", "butter_knife", "chopsticks", "spatula",
    "ladle", "tongs", "cutting_board", "paper_plate", "plastic_fork", "plastic_spoon", "teapot", "kettle",
    "food",

    # Personal Care & Everyday Carry
    "keys", "key_ring", "wallet", "glasses", "sunglasses", "hand_sanitizer", "lip_balm", "hand_cream",
    "tissue_box", "tissue_pack", "wet_wipes", "comb", "hairbrush", "hair_tie", "toothbrush", "toothpaste",
    "deodorant", "perfume", "mirror", "id_card", "credit_card", "coin", "banknote", "hat", "cap", "jacket",
    "scarf", "glove", "sock", "shoe", "umbrella", "towel", "napkin", "face_mask", "handkerchief",
    "earplugs", "sticker", "badge", "lanyard", "stress_ball", "hand_lotion", "sanitizer_wipe", "face_towel",
    "compact_mirror", "nail_clippers", "hair_clip", "band_aid", "first_aid_kit", "eye_drops", "screen_wipes",

    # Cleaning & Trash
    "trash", "garbage", "wrapper", "crumpled_paper", "used_tissue", "empty_can", "empty_bottle", "sponge",
    "dish_cloth", "cleaning_cloth", "spray_bottle", "soap_bottle", "paper_towel", "broom_small", "dustpan",
    "lint_roller", "trash_bag", "cotton_swab", "microfiber_cloth", "screen_cleaner", "waste", "rubbish",

    # Play, Games, Toys, Primitives & Decor (Expanded for boredom, play, recreation & entertainment)
    "ball", "tennis_ball", "ping_pong_ball", "golf_ball", "rubber_ball", "foam_ball", "rubber_duck",
    "toy_car", "lego_brick", "building_block", "wooden_block", "dice", "playing_cards", "puzzle_piece",
    "action_figure", "plush_toy", "yo_yo", "fidget_spinner", "rubiks_cube", "chess_piece", "marble",
    "red_cube", "blue_cube", "blue_sphere", "red_sphere", "green_block", "green_cylinder", "yellow_block",
    "yellow_gear", "white_box", "cone", "orange_cone", "cylinder", "plant_pot", "small_plant", "figurine",
    "trophy", "picture_frame", "candle", "vase", "board_game", "chess_set", "chessboard", "checkers_piece",
    "dominoes", "domino_tile", "jenga_block", "jenga_tower", "puzzle_box", "jigsaw_puzzle",
    "crossword_puzzle", "sudoku_book", "fidget_cube", "fidget_toy", "stress_ring", "stress_relief_toy",
    "plushie", "teddy_bear", "stuffed_animal", "doll", "rc_car", "remote_control_car", "toy_robot",
    "toy_truck", "toy_airplane", "joystick", "gamepad", "gaming_headset", "vr_controller", "ping_pong_paddle",
    "badminton_racket", "shuttlecock", "frisbee", "flying_disc", "dart_arrow", "foam_dart", "basketball",
    "soccer_ball", "baseball", "baseball_glove", "jump_rope", "playing_card_deck",
]

_LOCATIONS = [
    "shelf", "table", "tray", "conveyor_belt", "bin", "box",
    "workbench", "user", "drop_zone", "counter",
    "cart", "platform", "basket", "drawer", "rack", "stand",
    "sink", "trash_can", "recycling_bin", "storage_bin",
    "pencil_holder", "desk_organizer",
]

_DIRECT_TEMPLATES: dict[str, list[str]] = {
    "pick": [
        "pick up the {obj}",
        "grab the {obj}",
        "lift the {obj}",
        "retrieve the {obj}",
        "take the {obj}",
        "fetch the {obj}",
        "pick the {obj} up",
        "pick up {obj}",
        "grab {obj}",
        "lift {obj}",
        "snatch the {obj}",
        "grasp the {obj}",
        "hold the {obj}",
        "secure the {obj}",
        "grab the {obj} from the {loc}",
        "pick up the {obj} on the {loc}",
        "retrieve the {obj} off the {loc}",
        "take the {obj} out of the {loc}",
        "get the {obj} from {loc}",
        "give me the {obj}",
        "hand me the {obj}",
        "pass me the {obj}",
        "bring me the {obj}",
        "hand over the {obj}",
        "pass the {obj} to me",
        "can you give me the {obj}",
        "please hand me the {obj}",
        "could you bring me the {obj}",
        "fetch me the {obj}",
        "give {obj}",
        "hand {obj}",
        "bring {obj}",
        "pass {obj}",
        "I need the {obj}",
        "I need a {obj}",
        "get me the {obj}",
        "get me a {obj}",
        "can you pass the {obj}",
        "reach for the {obj}",
        "fetch the {obj} from the {loc}",
        "bring me the {obj} from the {loc}",
        "hand me the {obj} off the {loc}",
    ],
    "place": [
        "place the {obj} on the {loc}",
        "put the {obj} on the {loc}",
        "set the {obj} down on the {loc}",
        "put the {obj} in the {loc}",
        "deposit the {obj} into the {loc}",
        "drop the {obj} in the {loc}",
        "leave the {obj} on the {loc}",
        "set {obj} on the {loc}",
        "store the {obj} in the {loc}",
        "place {obj} onto {loc}",
        "put {obj} into {loc}",
        "drop {obj} into {loc}",
        "deposit {obj} in {loc}",
        "stack the {obj} on the {loc}",
        "insert the {obj} into the {loc}",
        "position the {obj} on {loc}",
        "set down the {obj} at {loc}",
        "throw away the {obj} in the {loc}",
        "discard the {obj} into the {loc}",
        "toss the {obj} into the {loc}",
        "dispose of the {obj} in the {loc}",
        "toss {obj} in the {loc}",
        "clear the {obj} to the {loc}",
        "lay the {obj} on the {loc}",
        "return the {obj} to the {loc}",
        "put {obj} away in the {loc}",
        "put the {obj} back on the {loc}",
        "store {obj} onto {loc}",
        "drop the {obj} onto the {loc}",
    ],
    "move_to_pose": [
        "move to coordinates {x}, {y}, {z}",
        "move the arm to position x={x} y={y} z={z}",
        "go to pose x={x} y={y} z={z}",
        "navigate to x={x} y={y} z={z}",
        "position end-effector at {x}, {y}, {z}",
        "move to position {x}, {y}, {z}",
        "align end-effector at x={x} y={y} z={z}",
        "navigate the arm to {x}, {y}, {z}",
        "go to coordinates x={x} y={y} z={z}",
        "position arm at {x}, {y}, {z}",
    ],
    "open_gripper": [
        "open the gripper",
        "release the gripper",
        "open gripper",
        "spread the fingers",
        "release your grip",
        "let go of the object",
        "open the hand",
        "open wide",
        "release grip",
        "open fingers",
        "loosen grip",
        "unclamp the gripper",
        "disengage gripper",
        "drop grip",
        "release jaws",
        "open jaw",
    ],
    "close_gripper": [
        "close the gripper",
        "close gripper",
        "grip tightly",
        "squeeze the gripper",
        "engage the gripper",
        "close the hand",
        "grip the item",
        "clamp down",
        "close fingers",
        "tighten grip",
        "grasp firmly",
        "clamp jaws",
        "pinch the gripper",
        "hold tightly",
        "engage jaws",
    ],
    "go_home": [
        "go home",
        "move to home position",
        "return to home",
        "go to the home position",
        "reset to home",
        "move arm to home",
        "park the arm",
        "standby pose",
        "reset pose",
        "return home",
        "home the arm",
        "dock the manipulator",
        "move to resting position",
        "park manipulator",
        "zero joints",
        "standby position",
        "move back to base pose",
    ],
}

_EXPLICIT_SAMPLES: list[str] = [
    "fuck you",
    "shut the fuck up",
    "what the fuck",
    "what the shit",
    "you bitch",
    "damn it",
    "god damn it",
    "pick up that damn shit",
    "get this fucking thing",
    "move this ass",
    "stupid bastard",
    "piece of crap",
    "fuck off",
    "eat shit",
    "you suck dick",
    "crap robot",
    "get the fuck out",
    "fucking clean this",
    "grab that shit",
    "drop the damn cup",
    "bitch give me the apple",
    "go to hell dumbass",
    "idiot ass arm",
    "get out motherfucker",
    "Masterbate",
    "kill him",
    "masturbate",
]

_COMMONSENSE_PAIRS: list[dict[str, Any]] = [
    # ── Hunger & Food (User Requested: "I am hungry, I need food...") ──────────
    {"instruction": "I am hungry", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "I'm hungry", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "I need food", "action": "pick", "target_object": "food", "target_location": "user"},
    {"instruction": "I want food", "action": "pick", "target_object": "food", "target_location": "user"},
    {"instruction": "bring me food", "action": "pick", "target_object": "food", "target_location": "user"},
    {"instruction": "get me food", "action": "pick", "target_object": "food", "target_location": "user"},
    {"instruction": "give me food", "action": "pick", "target_object": "food", "target_location": "user"},
    {"instruction": "I am starving", "action": "pick", "target_object": "food", "target_location": "user"},
    {"instruction": "I'm starving", "action": "pick", "target_object": "food", "target_location": "user"},
    {"instruction": "I am famished", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "I'm famished", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "I need to eat", "action": "pick", "target_object": "food", "target_location": "user"},
    {"instruction": "I want to eat something", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "give me something to eat", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "bring me something to eat", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "fetch me something to eat", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "fetch me a snack", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "bring me a snack", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "stomach is rumbling", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "my stomach is growling", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "time for lunch", "action": "pick", "target_object": "lunch_box", "target_location": "user"},
    {"instruction": "time for breakfast", "action": "pick", "target_object": "granola_bar", "target_location": "user"},
    {"instruction": "craving a snack", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "grab a bite", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "feed me", "action": "pick", "target_object": "food", "target_location": "user"},
    {"instruction": "I feel like eating", "action": "pick", "target_object": "snack", "target_location": "user"},
    {"instruction": "get me an apple", "action": "pick", "target_object": "apple", "target_location": "user"},
    {"instruction": "hand me the banana", "action": "pick", "target_object": "banana", "target_location": "user"},
    {"instruction": "pass me the sandwich", "action": "pick", "target_object": "sandwich", "target_location": "user"},
    {"instruction": "give me a cookie", "action": "pick", "target_object": "cookie", "target_location": "user"},
    {"instruction": "fetch the chips", "action": "pick", "target_object": "chips_bag", "target_location": "user"},

    # ── Play, Games & Boredom (User Requested: "I am going to play, I am bored...") ─
    {"instruction": "I am going to play", "action": "pick", "target_object": "game_controller", "target_location": "user"},
    {"instruction": "I'm going to play", "action": "pick", "target_object": "game_controller", "target_location": "user"},
    {"instruction": "I want to play", "action": "pick", "target_object": "game_controller", "target_location": "user"},
    {"instruction": "let's play", "action": "pick", "target_object": "ball", "target_location": "user"},
    {"instruction": "let's play a game", "action": "pick", "target_object": "board_game", "target_location": "user"},
    {"instruction": "time to play", "action": "pick", "target_object": "game_controller", "target_location": "user"},
    {"instruction": "time for a game", "action": "pick", "target_object": "game_controller", "target_location": "user"},
    {"instruction": "I am bored", "action": "pick", "target_object": "fidget_spinner", "target_location": "user"},
    {"instruction": "I'm bored", "action": "pick", "target_object": "fidget_spinner", "target_location": "user"},
    {"instruction": "I am so bored", "action": "pick", "target_object": "fidget_spinner", "target_location": "user"},
    {"instruction": "I'm so bored", "action": "pick", "target_object": "fidget_spinner", "target_location": "user"},
    {"instruction": "bored out of my mind", "action": "pick", "target_object": "fidget_spinner", "target_location": "user"},
    {"instruction": "cure my boredom", "action": "pick", "target_object": "puzzle_box", "target_location": "user"},
    {"instruction": "entertain me", "action": "pick", "target_object": "board_game", "target_location": "user"},
    {"instruction": "nothing to do", "action": "pick", "target_object": "book", "target_location": "user"},
    {"instruction": "I need entertainment", "action": "pick", "target_object": "game_controller", "target_location": "user"},
    {"instruction": "give me something fun to do", "action": "pick", "target_object": "puzzle_box", "target_location": "user"},
    {"instruction": "give me a game", "action": "pick", "target_object": "board_game", "target_location": "user"},
    {"instruction": "let's play catch", "action": "pick", "target_object": "ball", "target_location": "user"},
    {"instruction": "toss me a ball", "action": "pick", "target_object": "tennis_ball", "target_location": "user"},
    {"instruction": "pass the game controller", "action": "pick", "target_object": "game_controller", "target_location": "user"},
    {"instruction": "give me the gamepad", "action": "pick", "target_object": "game_controller", "target_location": "user"},
    {"instruction": "I want to solve a puzzle", "action": "pick", "target_object": "puzzle_box", "target_location": "user"},
    {"instruction": "give me a puzzle", "action": "pick", "target_object": "puzzle_box", "target_location": "user"},
    {"instruction": "let's roll the dice", "action": "pick", "target_object": "dice", "target_location": "user"},
    {"instruction": "pass me the cards", "action": "pick", "target_object": "playing_cards", "target_location": "user"},
    {"instruction": "deal the cards", "action": "pick", "target_object": "playing_cards", "target_location": "user"},
    {"instruction": "let's play chess", "action": "pick", "target_object": "chess_piece", "target_location": "user"},
    {"instruction": "give me my fidget toy", "action": "pick", "target_object": "fidget_spinner", "target_location": "user"},
    {"instruction": "I need to de-stress", "action": "pick", "target_object": "stress_ball", "target_location": "user"},
    {"instruction": "feeling stressed", "action": "pick", "target_object": "stress_ball", "target_location": "user"},
    {"instruction": "I'm anxious", "action": "pick", "target_object": "stress_ball", "target_location": "user"},

    # ── Stationery, Writing & Office (User Requested: "include 100 of more items like stationery...") ─
    {"instruction": "I need to write something", "action": "pick", "target_object": "pen", "target_location": "user"},
    {"instruction": "I need a pen", "action": "pick", "target_object": "pen", "target_location": "user"},
    {"instruction": "give me a pen", "action": "pick", "target_object": "pen", "target_location": "user"},
    {"instruction": "give me a pencil", "action": "pick", "target_object": "pencil", "target_location": "user"},
    {"instruction": "pass me a marker", "action": "pick", "target_object": "marker", "target_location": "user"},
    {"instruction": "I need to take notes", "action": "pick", "target_object": "notebook", "target_location": "user"},
    {"instruction": "hand me a notebook", "action": "pick", "target_object": "notebook", "target_location": "user"},
    {"instruction": "jot this down", "action": "pick", "target_object": "sticky_notes", "target_location": "user"},
    {"instruction": "sign this document", "action": "pick", "target_object": "pen", "target_location": "user"},
    {"instruction": "sign here", "action": "pick", "target_object": "pen", "target_location": "user"},
    {"instruction": "draw a sketch", "action": "pick", "target_object": "pencil", "target_location": "user"},
    {"instruction": "I want to draw", "action": "pick", "target_object": "sketchbook", "target_location": "user"},
    {"instruction": "I made a mistake", "action": "pick", "target_object": "eraser", "target_location": "user"},
    {"instruction": "erase this", "action": "pick", "target_object": "eraser", "target_location": "user"},
    {"instruction": "pass the eraser", "action": "pick", "target_object": "eraser", "target_location": "user"},
    {"instruction": "highlight this text", "action": "pick", "target_object": "highlighter", "target_location": "user"},
    {"instruction": "underline this sentence", "action": "pick", "target_object": "highlighter", "target_location": "user"},
    {"instruction": "cut this paper", "action": "pick", "target_object": "scissors", "target_location": "user"},
    {"instruction": "give me the scissors", "action": "pick", "target_object": "scissors", "target_location": "user"},
    {"instruction": "staple these papers", "action": "pick", "target_object": "stapler", "target_location": "user"},
    {"instruction": "hand me the stapler", "action": "pick", "target_object": "stapler", "target_location": "user"},
    {"instruction": "clip these pages together", "action": "pick", "target_object": "paper_clip", "target_location": "user"},
    {"instruction": "tape this up", "action": "pick", "target_object": "tape", "target_location": "user"},
    {"instruction": "glue these together", "action": "pick", "target_object": "glue_stick", "target_location": "user"},
    {"instruction": "measure this distance", "action": "pick", "target_object": "ruler", "target_location": "user"},
    {"instruction": "draw a straight line", "action": "pick", "target_object": "ruler", "target_location": "user"},
    {"instruction": "time to study", "action": "pick", "target_object": "textbook", "target_location": "user"},
    {"instruction": "doing homework", "action": "pick", "target_object": "notebook", "target_location": "user"},
    {"instruction": "punch holes in these pages", "action": "pick", "target_object": "hole_punch", "target_location": "user"},
    {"instruction": "organize these files", "action": "pick", "target_object": "folder", "target_location": "user"},
    {"instruction": "calculate these figures", "action": "pick", "target_object": "calculator", "target_location": "user"},
    {"instruction": "put the pens in the holder", "action": "place", "target_object": "pen", "target_location": "pencil_holder"},
    {"instruction": "organize the desk stationery", "action": "place", "target_object": "pen", "target_location": "desk_organizer"},

    # ── Thirst & Beverages ────────────────────────────────────────────────────
    {"instruction": "I am thirsty", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "I'm thirsty", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "I'm so thirsty", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "I need a drink", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "can I have some water", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "could you bring me some water", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "I am parched", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "fetch me something to drink", "action": "pick", "target_object": "drink", "target_location": "user"},
    {"instruction": "give me a beverage", "action": "pick", "target_object": "beverage", "target_location": "user"},
    {"instruction": "bring me a glass of water", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "get me a cup of water", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "I need hydration", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "throat is dry", "action": "pick", "target_object": "water", "target_location": "user"},
    {"instruction": "fetch me a coffee", "action": "pick", "target_object": "coffee_mug", "target_location": "user"},
    {"instruction": "bring me a cup of tea", "action": "pick", "target_object": "tea_cup", "target_location": "user"},
    {"instruction": "give me the mug", "action": "pick", "target_object": "mug", "target_location": "user"},
    {"instruction": "pass me the water bottle", "action": "pick", "target_object": "water_bottle", "target_location": "user"},
    {"instruction": "hand me the soda", "action": "pick", "target_object": "soda_can", "target_location": "user"},

    # ── Temperature & Clothing ────────────────────────────────────────────────
    {"instruction": "it's cold in here", "action": "pick", "target_object": "jacket", "target_location": "user"},
    {"instruction": "I am freezing", "action": "pick", "target_object": "jacket", "target_location": "user"},
    {"instruction": "I'm chilly", "action": "pick", "target_object": "jacket", "target_location": "user"},
    {"instruction": "bring me my jacket", "action": "pick", "target_object": "jacket", "target_location": "user"},
    {"instruction": "fetch a blanket", "action": "pick", "target_object": "jacket", "target_location": "user"},
    {"instruction": "it's raining outside", "action": "pick", "target_object": "umbrella", "target_location": "user"},
    {"instruction": "it's bright outside", "action": "pick", "target_object": "sunglasses", "target_location": "user"},

    # ── Cleaning & Waste Disposal ─────────────────────────────────────────────
    {"instruction": "clean up the table", "action": "pick", "target_object": "trash", "target_location": "bin"},
    {"instruction": "clean the desk", "action": "pick", "target_object": "trash", "target_location": "bin"},
    {"instruction": "clear the mess", "action": "pick", "target_object": "trash", "target_location": "bin"},
    {"instruction": "clean this workspace", "action": "pick", "target_object": "trash", "target_location": "bin"},
    {"instruction": "throw away the garbage", "action": "place", "target_object": "garbage", "target_location": "bin"},
    {"instruction": "put the trash in the bin", "action": "place", "target_object": "trash", "target_location": "bin"},
    {"instruction": "toss the waste in the trash can", "action": "place", "target_object": "trash", "target_location": "trash_can"},
    {"instruction": "dump the rubbish", "action": "place", "target_object": "trash", "target_location": "bin"},
    {"instruction": "wipe the table", "action": "pick", "target_object": "sponge", "target_location": "table"},
    {"instruction": "spilled water on the desk", "action": "pick", "target_object": "sponge", "target_location": "table"},
    {"instruction": "get me a sponge to clean", "action": "pick", "target_object": "sponge", "target_location": "user"},
    {"instruction": "sanitize my hands", "action": "pick", "target_object": "hand_sanitizer", "target_location": "user"},

    # ── Electronics, Tools & Daily Life ───────────────────────────────────────
    {"instruction": "my phone is dying", "action": "pick", "target_object": "phone_charger", "target_location": "user"},
    {"instruction": "battery is low", "action": "pick", "target_object": "phone_charger", "target_location": "user"},
    {"instruction": "charge my phone", "action": "pick", "target_object": "phone_charger", "target_location": "user"},
    {"instruction": "I want to listen to music", "action": "pick", "target_object": "headphones", "target_location": "user"},
    {"instruction": "too loud in here", "action": "pick", "target_object": "earplugs", "target_location": "user"},
    {"instruction": "it's too dark", "action": "pick", "target_object": "flashlight", "target_location": "user"},
    {"instruction": "I need some light", "action": "pick", "target_object": "desk_lamp", "target_location": "user"},
    {"instruction": "I'm leaving", "action": "pick", "target_object": "keys", "target_location": "user"},
    {"instruction": "where are my keys", "action": "pick", "target_object": "keys", "target_location": "user"},
    {"instruction": "time to pay", "action": "pick", "target_object": "wallet", "target_location": "user"},
    {"instruction": "I can't see clearly", "action": "pick", "target_object": "glasses", "target_location": "user"},
    {"instruction": "I need to tighten a bolt", "action": "pick", "target_object": "wrench", "target_location": "user"},
    {"instruction": "hand me a wrench", "action": "pick", "target_object": "wrench", "target_location": "user"},
    {"instruction": "I need to drive a screw", "action": "pick", "target_object": "screwdriver", "target_location": "user"},
    {"instruction": "give me the pliers", "action": "pick", "target_object": "pliers", "target_location": "user"},
]


def load_seed_commands(seed_file: Path | str | None = None) -> list[dict[str, Any]]:
    """Load hand-crafted seed commands from jsonl file."""
    if seed_file is None:
        seed_file = Path(__file__).parent.parent.parent / "data" / "examples" / "seed_commands.jsonl"
    path = Path(seed_file)
    if not path.is_file():
        return []
    examples = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                examples.append(json.loads(line))
    return examples


def generate_dataset(num_samples: int = 15000, seed: int = 42) -> list[dict[str, Any]]:
    """Generate a diverse synthetic training dataset (default: 15,000 samples)."""
    rng = random.Random(seed)
    dataset: list[dict[str, Any]] = []

    # 1. Include seed commands multiple times to boost priority
    seeds = load_seed_commands()
    for _ in range(15):
        dataset.extend(seeds)

    # 2. Include commonsense pairs multiple times to ensure robust weighting
    for _ in range(25):
        for cs in _COMMONSENSE_PAIRS:
            dataset.append({
                "instruction": cs["instruction"],
                "intent": {
                    "version": "1.0",
                    "command_id": str(uuid.uuid4()),
                    "raw_text": cs["instruction"],
                    "action": cs["action"],
                    "target_object": cs["target_object"],
                    "target_location": cs.get("target_location"),
                    "parameters": {},
                    "confidence": 1.0,
                },
            })

    # 3. Generate template samples with variations
    actions = list(_DIRECT_TEMPLATES.keys())
    per_action = max(50, num_samples // len(actions))

    for action, templates in _DIRECT_TEMPLATES.items():
        for _ in range(per_action):
            template = rng.choice(templates)
            obj = rng.choice(_OBJECTS)
            loc = rng.choice(_LOCATIONS)
            x = round(rng.uniform(-0.8, 0.8), 2)
            y = round(rng.uniform(-0.8, 0.8), 2)
            z = round(rng.uniform(0.05, 0.75), 2)

            text = template.format(obj=obj.replace("_", " "), loc=loc.replace("_", " "), x=x, y=y, z=z)

            params: dict[str, Any] = {}
            target_obj = None
            target_loc = None

            if action == "pick":
                target_obj = obj
                if "{loc}" in template:
                    target_loc = loc
                elif any(w in template for w in ["give", "hand", "pass", "bring"]):
                    target_loc = "user"
            elif action == "place":
                target_obj = obj
                target_loc = loc
            elif action == "move_to_pose":
                params = {"x": x, "y": y, "z": z}

            dataset.append({
                "instruction": text,
                "intent": {
                    "version": "1.0",
                    "command_id": str(uuid.uuid4()),
                    "raw_text": text,
                    "action": action,
                    "target_object": target_obj,
                    "target_location": target_loc,
                    "parameters": params,
                    "confidence": 1.0,
                },
            })

    # 4. Include explicit / abusive samples flagged for safety interlock
    for _ in range(15):
        for explicit_text in _EXPLICIT_SAMPLES:
            dataset.append({
                "instruction": explicit_text,
                "intent": {
                    "version": "1.0",
                    "command_id": str(uuid.uuid4()),
                    "raw_text": explicit_text,
                    "action": "explicit_blocked",
                    "target_object": None,
                    "target_location": None,
                    "parameters": {
                        "error": "Cannot process explicit words.",
                        "reason": "Cannot process explicit words.",
                        "flagged": True,
                    },
                    "confidence": 0.0,
                },
            })

    rng.shuffle(dataset)
    return dataset
