# WorldObject — one entry of the world-model scene graph
string id                           # unique object identifier, e.g. "cup"
string label                        # perception class label
geometry_msgs/PoseStamped pose      # last known pose (header.stamp = time of that knowledge)
string state                        # detected | grasped | moved | placed | missing | unknown
string location                     # semantic location, e.g. "table", "shelf", "gripper"
bool visible                        # true only while perception currently reports the object
builtin_interfaces/Time last_seen   # last time perception observed the object
float32 confidence                  # detection score decayed by observation age [0.0, 1.0]
