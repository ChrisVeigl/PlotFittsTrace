import os
import sys

def merge_FittsTask_lines(folder_path, output_file='results.sd3'):
    # Get a list of all files in the specified folder
    files = [f for f in os.listdir(folder_path) if f.endswith('.sd3')]

    # Check if there are any text files in the folder
    if not files:
        print(f"No sd3 files found in the specified folder: {folder_path}")
        return

    # Open the output file for writing
    with open(output_file, 'w') as result_file:
    
        result_file.write('TRACE DATA\n')
        result_file.write('App,Participant,Condition,Session,Group,TaskType,SelectionMethod,Block,Sequence,A,W,Trial,from_x,from_y,to_x,to_y,{t_x_y}\n')
        
        # Iterate through each text file
        for file in files:
            file_path = os.path.join(folder_path, file)
            with open(file_path, 'r') as current_file:
                # Filter lines that start with "FittsTask" and write them to the output file
                FittsTask_lines = [line.strip() for line in current_file if line.strip().startswith("FittsTask")]
                if FittsTask_lines:
                    result_file.write('\n'.join(FittsTask_lines))
                    result_file.write('\n')  # Add extra newline between files

    print(f"Merged lines starting with 'FittsTask' from {len(files)} text files into {output_file}.")

if __name__ == "__main__":
    # Check if the folder path is provided as a command-line argument
    if len(sys.argv) != 2:
        print("Usage: python merger.py /path/to/your/FittTaskSD3files")
        sys.exit(1)

    folder_path = sys.argv[1]
    merge_FittsTask_lines(folder_path)
